import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as webhookRoute } from "@/app/api/webhooks/tiktok/route";
import type { Database } from "@/lib/db/database.types";
import { signBody } from "@/lib/domain/hmac";
import { filterSpecSchema, runFilterSpec } from "@/lib/domain/nl-query";
import { orderCreated } from "@/lib/simulator/payloads";

/**
 * NL query safety tests. We do NOT hit Anthropic here — the API is stubbed
 * out at the boundary. What we prove:
 *   - the filter spec zod schema refuses SQL-shaped or unknown-column garbage
 *   - the query builder maps a well-formed spec to the expected rows
 *   - unknown enum values (channel, status) are refused
 *   - .strict() rejects extra keys the model might invent
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describe("filterSpecSchema (unit)", () => {
  it("accepts a minimal spec", () => {
    const parsed = filterSpecSchema.safeParse({ channel: "tiktok_shop" });
    expect(parsed.success).toBe(true);
  });

  it("accepts a rich spec", () => {
    const parsed = filterSpecSchema.safeParse({
      brand: "Voltcore",
      channel: "tiktok_shop",
      status: "allocated",
      placed_after: "2026-07-27T00:00:00Z",
      min_subtotal_cents: 10000,
      limit: 20,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses unknown channel values", () => {
    const parsed = filterSpecSchema.safeParse({ channel: "shopify" });
    expect(parsed.success).toBe(false);
  });

  it("refuses unknown status values", () => {
    const parsed = filterSpecSchema.safeParse({ status: "in_transit" });
    expect(parsed.success).toBe(false);
  });

  it("refuses extra keys (strict mode) — no free-form fields the model might invent", () => {
    const parsed = filterSpecSchema.safeParse({ sql: "select 1", channel: "tiktok_shop" });
    expect(parsed.success).toBe(false);
  });

  it("refuses non-integer money", () => {
    const parsed = filterSpecSchema.safeParse({ min_subtotal_cents: 99.99 });
    expect(parsed.success).toBe(false);
  });

  it("refuses limits over the cap", () => {
    const parsed = filterSpecSchema.safeParse({ limit: 5000 });
    expect(parsed.success).toBe(false);
  });
});

describeIntegration("runFilterSpec (integration)", () => {
  const secret = process.env.WEBHOOK_SHARED_SECRET!;
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    // seed a couple of orders so filters return something
    for (const p of [
      orderCreated({
        lines: [{ external_sku: "TTS-VC-BT-100", qty: 1, unit_price_cents: 15000 }],
      }),
      orderCreated({
        lines: [{ external_sku: "TTS-PB-PRO-750", qty: 1, unit_price_cents: 25000 }],
      }),
    ]) {
      const body = JSON.stringify(p);
      const signature = await signBody(secret, body);
      await webhookRoute(
        new Request("http://test/api/webhooks/tiktok", {
          method: "POST",
          headers: { "content-type": "application/json", "x-signature": signature },
          body,
        }),
      );
    }
  });

  it("brand filter narrows results to matching brand_name", async () => {
    const rows = await runFilterSpec(db, { brand: "Voltcore", limit: 100 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.brand_name.toLowerCase()).toContain("voltcore");
    }
  });

  it("channel + min_subtotal_cents narrows correctly", async () => {
    const rows = await runFilterSpec(db, {
      channel: "tiktok_shop",
      min_subtotal_cents: 20000,
      limit: 100,
    });
    for (const r of rows) {
      expect(r.channel_id).toBe("tiktok_shop");
      expect(r.subtotal_cents).toBeGreaterThanOrEqual(20000);
    }
  });

  it("limit caps the row count", async () => {
    const rows = await runFilterSpec(db, { limit: 1 });
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("empty spec returns the most recent orders (limit default 50)", async () => {
    const rows = await runFilterSpec(db, {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});
