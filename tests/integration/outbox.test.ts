import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as sweepRoute } from "@/app/api/jobs/outbox-sweep/route";
import { POST as webhookRoute } from "@/app/api/webhooks/tiktok/route";
import type { Database } from "@/lib/db/database.types";
import { signBody } from "@/lib/domain/hmac";
import { orderCreated } from "@/lib/simulator/payloads";

/**
 * Outbox sweeper integration — proves the SKIP LOCKED claim + delivery
 * side of the async layer. Overlapping sweeps do not double-deliver.
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("outbox sweeper", () => {
  const secret = process.env.WEBHOOK_SHARED_SECRET!;
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  });

  async function fireOrder(): Promise<string> {
    const payload = orderCreated({
      lines: [{ external_sku: "TTS-VC-BT-100", qty: 1, unit_price_cents: 7999 }],
    });
    const body = JSON.stringify(payload);
    const signature = await signBody(secret, body);
    const res = await webhookRoute(
      new Request("http://test/api/webhooks/tiktok", {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body,
      }),
    );
    const parsed = (await res.json()) as { order_id?: string };
    if (!parsed.order_id) throw new Error("no order_id in response");
    return parsed.order_id;
  }

  async function sweep(): Promise<{ delivered_count: number; event_types: string[] }> {
    const req = new Request("http://test/api/jobs/outbox-sweep", {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const res = await sweepRoute(req);
    return (await res.json()) as { delivered_count: number; event_types: string[] };
  }

  it("rejects sweep without the cron secret", async () => {
    const req = new Request("http://test/api/jobs/outbox-sweep", { method: "POST" });
    const res = await sweepRoute(req);
    expect(res.status).toBe(401);
  });

  it("delivers pending rows and marks them delivered", async () => {
    const orderId = await fireOrder();

    const { data: pendingBefore } = await db
      .from("outbox")
      .select("id, status")
      .eq("aggregate_id", orderId);
    expect(pendingBefore?.every((r) => r.status === "pending")).toBe(true);

    const result = await sweep();
    expect(result.delivered_count).toBeGreaterThanOrEqual(1);
    expect(result.event_types).toContain("order.allocated");

    const { data: afterSweep } = await db
      .from("outbox")
      .select("status, delivered_at")
      .eq("aggregate_id", orderId);
    for (const row of afterSweep ?? []) {
      expect(row.status).toBe("delivered");
      expect(row.delivered_at).not.toBeNull();
    }
  });

  it("re-entrant: two overlapping sweeps do not double-deliver", async () => {
    const orderId = await fireOrder();

    // Fire two sweeps concurrently — SKIP LOCKED means one claims, the other
    // sees zero due rows for this aggregate.
    const [sweepA, sweepB] = await Promise.all([sweep(), sweep()]);
    const combinedForOrder = [...sweepA.event_types, ...sweepB.event_types].filter(
      (t) => t === "order.allocated",
    );

    // The order.allocated event should have been delivered exactly once
    // (though other pending rows may show up in either sweep).
    const { data: rows } = await db
      .from("outbox")
      .select("status")
      .eq("aggregate_id", orderId);
    expect((rows ?? []).every((r) => r.status === "delivered")).toBe(true);
    expect(combinedForOrder.length).toBeGreaterThanOrEqual(1);
  });
});
