import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as erpWebhookRoute } from "@/app/api/webhooks/erp/route";
import type { Database } from "@/lib/db/database.types";
import { signBody } from "@/lib/domain/hmac";
import { esiCount, esiDamage } from "@/lib/simulator/payloads";
import { resetEphemera } from "@/tests/helpers/reset-ephemera";

/**
 * ESI/ERP mastership tests (ADR-011, migration 013).
 *
 * Covers:
 *   - stock.counted → ledger adjustment + rollup update
 *   - stock.damaged → negative damage movement + rollup update
 *   - Dedupe on (erp_esi, event_id) — same event_id twice is a no-op
 *   - Bad HMAC → dead, no ledger side-effect
 *   - Full BACKSTOP loop: skew_erp → erp_drift finding with authority
 *     inverted → accept_source → adjustment posted → next recon clean
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("ESI/ERP mastership", () => {
  const secret = process.env.WEBHOOK_SHARED_SECRET!;
  let db: SupabaseClient<Database>;
  let vcBt100Id: string;
  let vanNuysId: string;

  beforeAll(async () => {
    await resetEphemera();
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const [{ data: p }, { data: l }] = await Promise.all([
      db.from("products").select("id").eq("sku", "VC-BT-100").single(),
      db.from("locations").select("id").eq("name", "Van Nuys DC").single(),
    ]);
    vcBt100Id = p!.id;
    vanNuysId = l!.id;
  });

  async function currentOnHand(): Promise<number> {
    const { data } = await db
      .from("stock_levels")
      .select("on_hand")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .single();
    return data?.on_hand ?? 0;
  }

  async function fireErp(payload: unknown, opts?: { badSecret?: boolean }): Promise<{ status: number; body: unknown }> {
    const body = JSON.stringify(payload);
    const signature = await signBody(opts?.badSecret ? "wrong" : secret, body);
    const res = await erpWebhookRoute(
      new Request("http://test/api/webhooks/erp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body,
      }),
    );
    return { status: res.status, body: await res.json() };
  }

  it("stock.counted: appends adjustment ledger movement + updates rollup", async () => {
    const before = await currentOnHand();

    const payload = esiCount({ countedQty: before - 3 });
    const { status, body } = await fireErp(payload);
    expect(status).toBe(200);
    expect((body as { status?: string }).status).toBe("processed");

    const after = await currentOnHand();
    expect(after).toBe(before - 3);

    // Ledger has an adjustment row with the story
    const { data: movements } = await db
      .from("stock_movements")
      .select("qty_delta, reason, ref_type, note")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .eq("ref_type", "erp_count")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(movements?.[0].qty_delta).toBe(-3);
    expect(movements?.[0].reason).toBe("adjustment");
    expect(movements?.[0].note ?? "").toMatch(/ESI cycle count/);
  });

  it("dedupe: same event_id twice is a no-op", async () => {
    const before = await currentOnHand();
    const payload = esiCount({ countedQty: before - 5 });

    await fireErp(payload);
    const mid = await currentOnHand();
    expect(mid).toBe(before - 5);

    // Fire same event_id again with a DIFFERENT counted_qty — dedupe
    // means the second payload is dropped on the floor.
    const { body } = await fireErp({ ...payload, stock: { ...payload.stock, counted_qty: 1 } });
    expect((body as { deduped?: boolean }).deduped).toBe(true);

    const after = await currentOnHand();
    expect(after).toBe(mid);
  });

  it("bad HMAC: dead status, no ledger side-effect", async () => {
    const before = await currentOnHand();
    const payload = esiCount({ countedQty: before + 100 });
    const { status, body } = await fireErp(payload, { badSecret: true });
    expect(status).toBe(401);
    expect((body as { error?: string }).error).toMatch(/signature|invalid/i);
    expect(await currentOnHand()).toBe(before);
  });

  it("stock.damaged: writes damage movement, decrements on_hand", async () => {
    const before = await currentOnHand();
    const { status, body } = await fireErp(esiDamage({ qty: 2 }));
    expect(status).toBe(200);
    expect((body as { status?: string }).status).toBe("processed");

    expect(await currentOnHand()).toBe(before - 2);

    const { data: movements } = await db
      .from("stock_movements")
      .select("qty_delta, reason")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .eq("ref_type", "erp_damage")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(movements?.[0].qty_delta).toBe(-2);
    expect(movements?.[0].reason).toBe("damage");
  });

  it("BACKSTOP: skew ESI → erp_drift finding with authority inverted → accept → next clean", async () => {
    const ourOnHand = await currentOnHand();

    // ESI reports +5 vs our on_hand. Finding.expected = ESI, finding.actual = us.
    await db.rpc("skew_erp_report", {
      p_sku: "VC-BT-100",
      p_location: "Van Nuys DC",
      p_delta: 5,
    });

    const { data: runId } = await db.rpc("run_reconciliation");
    const { data: findings } = await db
      .from("reconciliation_findings")
      .select("id, kind, expected, actual, delta, location_id")
      .eq("run_id", runId as unknown as string)
      .eq("kind", "erp_drift")
      .eq("product_id", vcBt100Id);
    expect(findings?.length ?? 0).toBe(1);
    expect(findings![0].expected).toBe(ourOnHand + 5); // ESI's number
    expect(findings![0].actual).toBe(ourOnHand);       // ours
    expect(findings![0].location_id).toBe(vanNuysId);

    // Accept ESI: adjustment +5 posted to ledger + rollup
    const { data: resolveResult } = await db.rpc("resolve_reconciliation_finding", {
      p_finding_id: findings![0].id,
      p_strategy: "accept_source",
    });
    expect((resolveResult as { outcome?: string })?.outcome).toBe("resolved");

    expect(await currentOnHand()).toBe(ourOnHand + 5);

    // The adjustment row shows the reconciliation-driven correction
    const { data: adj } = await db
      .from("stock_movements")
      .select("qty_delta, reason, ref_type, note")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .eq("ref_type", "reconciliation")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(adj?.[0].qty_delta).toBe(5);
    expect(adj?.[0].reason).toBe("adjustment");
    expect(adj?.[0].note ?? "").toMatch(/accepted ESI count/);

    // Next reconciliation: no new erp_drift for this SKU/location
    const { data: run2 } = await db.rpc("run_reconciliation");
    const { data: findings2 } = await db
      .from("reconciliation_findings")
      .select("id")
      .eq("run_id", run2 as unknown as string)
      .eq("kind", "erp_drift")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId);
    expect(findings2?.length ?? 0).toBe(0);
  });
});
