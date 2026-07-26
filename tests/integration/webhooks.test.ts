import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as webhookRoute } from "@/app/api/webhooks/tiktok/route";
import type { Database } from "@/lib/db/database.types";
import { signBody } from "@/lib/domain/hmac";
import {
  burst,
  duplicate,
  malformedMissingRequiredFields,
  orderCreated,
  overshootOrder,
  unknownSkuOrder,
} from "@/lib/simulator/payloads";

/**
 * Integration tests — hit the real POST handler with a real Request against
 * local Supabase. This is our Day-2 executable proof that the six invariants
 * in db/tests/invariants.sql still hold end-to-end through the app layer.
 *
 * Skipped when Supabase env is not present so CI's quality job doesn't
 * flake (the ingestion job that runs these gets its own env — see PR body).
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("webhook ingestion", () => {
  const secret = process.env.WEBHOOK_SHARED_SECRET!;
  let db: SupabaseClient<Database>;
  let vc100ProductId: string;
  let vanNuysLocationId: string;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const [{ data: product }, { data: location }] = await Promise.all([
      db.from("products").select("id").eq("sku", "VC-BT-100").single(),
      db.from("locations").select("id").eq("name", "Van Nuys DC").single(),
    ]);
    if (!product || !location) {
      throw new Error("seed data missing — run `supabase db reset`");
    }
    vc100ProductId = product.id;
    vanNuysLocationId = location.id;
  });

  async function fire(payload: unknown, opts: { badSecret?: boolean; sigOverride?: string } = {}) {
    const body = JSON.stringify(payload);
    const usedSecret = opts.badSecret ? "not-the-real-secret" : secret;
    const signature = opts.sigOverride ?? (await signBody(usedSecret, body));
    const req = new Request("http://test/api/webhooks/tiktok", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    const res = await webhookRoute(req);
    const parsed = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body: parsed };
  }

  async function committedFor(productId: string, locationId: string): Promise<number> {
    const { data } = await db
      .from("stock_levels")
      .select("committed")
      .eq("product_id", productId)
      .eq("location_id", locationId)
      .single();
    return data?.committed ?? 0;
  }

  async function ledgerVsRollupAt(locationId: string): Promise<{ drift: number; rows: number }> {
    const [{ data: levels }, { data: ledger }] = await Promise.all([
      db.from("stock_levels").select("product_id, on_hand").eq("location_id", locationId),
      db.from("current_stock_from_ledger").select("product_id, on_hand_ledger").eq("location_id", locationId),
    ]);
    let drift = 0;
    const byProduct = new Map<string, number>();
    for (const l of ledger ?? []) {
      if (l.product_id != null && l.on_hand_ledger != null) {
        byProduct.set(l.product_id, l.on_hand_ledger);
      }
    }
    for (const lv of levels ?? []) {
      const l = byProduct.get(lv.product_id) ?? 0;
      drift += Math.abs(lv.on_hand - l);
    }
    return { drift, rows: (levels ?? []).length };
  }

  it("happy path — order.created allocates and records processed event", async () => {
    const before = await committedFor(vc100ProductId, vanNuysLocationId);
    const payload = orderCreated({
      lines: [{ external_sku: "TTS-VC-BT-100", qty: 2, unit_price_cents: 7999 }],
    });

    const res = await fire(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("allocated");
    expect(res.body.order_id).toBeTypeOf("string");
    expect(res.body.event_id).toBeTypeOf("string");

    const after = await committedFor(vc100ProductId, vanNuysLocationId);
    // >= 2, not == 2: other tests share the DB and may add reservations
    // between the before/after snapshots. The invariant the route owes us
    // is "at least the qty I asked for was reserved."
    expect(after - before).toBeGreaterThanOrEqual(2);

    const { data: event } = await db
      .from("webhook_events")
      .select("status, signature_valid")
      .eq("external_event_id", payload.event_id)
      .single();
    expect(event?.status).toBe("processed");
    expect(event?.signature_valid).toBe(true);

    const { data: outboxRows } = await db
      .from("outbox")
      .select("event_type")
      .eq("aggregate_id", res.body.order_id as string);
    expect(outboxRows).toEqual([{ event_type: "order.allocated" }]);
  });

  it("duplicate delivery — same event_id returns 200 deduped, no double-allocate", async () => {
    const payload = orderCreated({
      lines: [{ external_sku: "TTS-VC-BT-100", qty: 1, unit_price_cents: 7999 }],
    });

    const first = await fire(payload);
    const committedAfterFirst = await committedFor(vc100ProductId, vanNuysLocationId);

    const second = await fire(duplicate(payload));

    expect(first.status).toBe(200);
    expect(first.body.status).toBe("allocated");
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.order_id).toBeUndefined();

    // committed did not move on the second delivery
    const committedAfterSecond = await committedFor(vc100ProductId, vanNuysLocationId);
    expect(committedAfterSecond).toBe(committedAfterFirst);
  });

  it("bad HMAC signature — 401 and event recorded as dead", async () => {
    const payload = orderCreated();
    const res = await fire(payload, { badSecret: true });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signature/i);

    const { data: event } = await db
      .from("webhook_events")
      .select("status, signature_valid, last_error")
      .eq("external_event_id", payload.event_id)
      .single();
    expect(event?.status).toBe("dead");
    expect(event?.signature_valid).toBe(false);
    expect(event?.last_error ?? "").toMatch(/signature/i);
  });

  it("unknown SKU — 200 with error, event failed (DLQ visible)", async () => {
    const payload = unknownSkuOrder();
    const res = await fire(payload);

    expect(res.status).toBe(200);
    expect(res.body.error).toMatch(/unknown external_sku/i);
    expect(res.body.event_id).toBeTypeOf("string");

    const { data: event } = await db
      .from("webhook_events")
      .select("status, last_error")
      .eq("external_event_id", payload.event_id)
      .single();
    expect(event?.status).toBe("failed");
    expect(event?.last_error ?? "").toMatch(/unknown external_sku/i);
  });

  it("oversell — allocate > on_hand returns backordered, no partial reservation", async () => {
    const before = await committedFor(vc100ProductId, vanNuysLocationId);
    const payload = overshootOrder();

    const res = await fire(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("backordered");

    // committed unchanged — the CHECK firewall + inner exception rolled back
    const after = await committedFor(vc100ProductId, vanNuysLocationId);
    expect(after).toBe(before);

    // outbox got the backordered signal
    const { data: outboxRows } = await db
      .from("outbox")
      .select("event_type")
      .eq("aggregate_id", res.body.order_id as string);
    expect(outboxRows).toEqual([{ event_type: "order.backordered" }]);
  });

  it("burst of 25 — every response is 2xx and ledger still equals rollup", async () => {
    const payloads = burst(25);
    const results = await Promise.all(payloads.map((p) => fire(p)));

    for (const r of results) {
      expect([200]).toContain(r.status);
      expect(["allocated", "backordered"]).toContain(r.body.status);
    }

    const { drift, rows } = await ledgerVsRollupAt(vanNuysLocationId);
    expect(rows).toBeGreaterThan(0);
    expect(drift).toBe(0);
  });

  it("malformed JSON — 400 and event recorded with synth id + failed status", async () => {
    const body = "{ this is not json ]";
    const signature = await signBody(secret, body);
    const req = new Request("http://test/api/webhooks/tiktok", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    const res = await webhookRoute(req);
    const parsed = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(parsed.error).toMatch(/JSON/i);

    const { data: events } = await db
      .from("webhook_events")
      .select("external_event_id, status")
      .like("external_event_id", "malformed_%");
    expect((events ?? []).length).toBeGreaterThan(0);
    expect((events ?? [])[0].status).toBe("failed");
  });

  it("schema-invalid but signed — 400 and event visible in DLQ", async () => {
    const payload = malformedMissingRequiredFields();
    const res = await fire(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/schema/i);
  });

  it("cancel-before-create — event goes to DLQ for retry after create arrives", async () => {
    const externalOrderId = `TTS-CANCEL-FIRST-${crypto.randomUUID().slice(0, 8)}`;
    const cancel = {
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "order.cancelled" as const,
      occurred_at: new Date().toISOString(),
      order: {
        external_order_id: externalOrderId,
        placed_at: new Date().toISOString(),
        lines: [{ external_sku: "TTS-VC-BT-100", qty: 1, unit_price_cents: 7999 }],
      },
    };

    const res = await fire(cancel);
    expect(res.status).toBe(200);
    expect(res.body.error).toMatch(/cannot cancel unknown order/i);

    const { data: event } = await db
      .from("webhook_events")
      .select("status")
      .eq("external_event_id", cancel.event_id)
      .single();
    expect(event?.status).toBe("failed");
  });
});
