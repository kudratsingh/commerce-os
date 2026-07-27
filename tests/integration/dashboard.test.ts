import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as retryRoute } from "@/app/api/dlq/retry/route";
import { POST as webhookRoute } from "@/app/api/webhooks/tiktok/route";
import type { Database } from "@/lib/db/database.types";
import { signBody } from "@/lib/domain/hmac";
import { getDlqEvents } from "@/lib/queries/dlq";
import { getRecentOrders } from "@/lib/queries/orders";
import { getStockLevels } from "@/lib/queries/stock";
import { getDashboardSummary } from "@/lib/queries/summary";
import { orderCreated, unknownSkuOrder } from "@/lib/simulator/payloads";

/**
 * Day-3 integration tests. Covers:
 *   - dashboard read-model queries return the shape the components expect
 *   - retry_webhook_event round-trip (failed → root cause fixed → allocated)
 *   - retry endpoint refuses bad-signature events
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("dashboard queries + DLQ retry", () => {
  const secret = process.env.WEBHOOK_SHARED_SECRET!;
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  });

  async function fireWebhook(payload: unknown, opts: { badSecret?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const secretToUse = opts.badSecret ? "not-the-real-secret" : secret;
    const signature = await signBody(secretToUse, body);
    return webhookRoute(
      new Request("http://test/api/webhooks/tiktok", {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body,
      }),
    );
  }

  it("getDashboardSummary returns the totals view shape", async () => {
    const summary = await getDashboardSummary(db);
    expect(summary).toEqual(
      expect.objectContaining({
        gmv_cents: expect.any(Number),
        orders_count: expect.any(Number),
        received_count: expect.any(Number),
        processed_count: expect.any(Number),
        failed_count: expect.any(Number),
        dead_count: expect.any(Number),
        dlq_count: expect.any(Number),
      }),
    );
  });

  it("getStockLevels returns rows per product+location with low_stock flag", async () => {
    const rows = await getStockLevels(db, 50);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(first.sku).toMatch(/^[A-Z0-9-]+$/);
    expect(first.available).toBe(first.on_hand - first.committed);
    expect(typeof first.low_stock).toBe("boolean");
  });

  it("getRecentOrders returns rows joined to brand names", async () => {
    // seed at least one order via the webhook path
    await fireWebhook(orderCreated());
    const rows = await getRecentOrders(db, 5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].brand_name).toBeTypeOf("string");
    expect(rows[0].brand_name.length).toBeGreaterThan(0);
  });

  it("retry_webhook_event: fix root cause, retry succeeds", async () => {
    // seed a failing event with an unknown SKU
    const payload = unknownSkuOrder();
    await fireWebhook(payload);

    // event should be in the DLQ
    let dlq = await getDlqEvents(db, 25);
    const target = dlq.find((r) => r.external_event_id === payload.event_id);
    expect(target).toBeDefined();
    expect(target!.status).toBe("failed");
    expect(target!.last_error ?? "").toMatch(/unknown external_sku/i);

    // Fix the root cause: register the missing SKU under any brand's product
    const { data: someProduct } = await db.from("products").select("id").limit(1).single();
    expect(someProduct?.id).toBeDefined();
    const { error: listingErr } = await db
      .from("channel_listings")
      .insert({
        product_id: someProduct!.id,
        channel_id: "tiktok_shop",
        external_sku: "TTS-DOES-NOT-EXIST",
      });
    expect(listingErr).toBeNull();

    // Retry via the route
    const retryRes = await retryRoute(
      new Request("http://test/api/dlq/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_id: target!.id }),
      }),
    );
    const retryBody = (await retryRes.json()) as { outcome: string; order_id?: string };
    expect(retryRes.status).toBe(200);
    expect(["allocated", "backordered"]).toContain(retryBody.outcome);

    // event now processed, no longer in DLQ
    dlq = await getDlqEvents(db, 25);
    expect(dlq.find((r) => r.external_event_id === payload.event_id)).toBeUndefined();

    // cleanup so subsequent tests don't see the listing
    await db
      .from("channel_listings")
      .delete()
      .eq("channel_id", "tiktok_shop")
      .eq("external_sku", "TTS-DOES-NOT-EXIST");
  });

  it("retry_webhook_event: bad-signature events are refused", async () => {
    const payload = orderCreated();
    await fireWebhook(payload, { badSecret: true }); // creates a 'dead' event

    const { data: dead } = await db
      .from("webhook_events")
      .select("id, status")
      .eq("external_event_id", payload.event_id)
      .single();
    expect(dead?.status).toBe("dead");

    const retryRes = await retryRoute(
      new Request("http://test/api/dlq/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_id: dead!.id }),
      }),
    );
    const retryBody = (await retryRes.json()) as { outcome: string; reason?: string };
    expect(retryRes.status).toBe(200);
    expect(retryBody.outcome).toBe("refused");
    expect(retryBody.reason ?? "").toMatch(/signature/i);
  });

  it("retry endpoint rejects malformed body", async () => {
    const res = await retryRoute(
      new Request("http://test/api/dlq/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_id: "not-a-uuid" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
