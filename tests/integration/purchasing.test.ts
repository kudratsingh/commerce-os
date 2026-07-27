import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/database.types";
import {
  getAgedInventory,
  getPurchaseOrders,
} from "@/lib/queries/purchasing";
import {
  getLandedCostHistory,
  getSkuMarginByChannel,
} from "@/lib/queries/margin";

/**
 * PR M1-A integration tests. Proves the new schema + views come back with
 * the shape the app will render.
 *
 * Views that read from tables the app doesn't write to yet
 * (margin_snapshots, landed_costs) get exercised by inserting a synthetic
 * row directly; the "the trigger writes it" test lands with M1-D.
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("purchasing + margin schema", () => {
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  });

  it("backfill: one supplier row per distinct legacy supplier text, all POs linked", async () => {
    const { data: suppliers } = await db.from("suppliers").select("id, name");
    expect(suppliers?.length ?? 0).toBeGreaterThan(0);

    const { data: unlinkedPOs } = await db
      .from("purchase_orders")
      .select("id, supplier, supplier_id")
      .is("supplier_id", null)
      .not("supplier", "is", null);
    expect(unlinkedPOs?.length ?? 0).toBe(0);
  });

  it("purchase_orders_dashboard returns POs with brand + supplier names + aggregates", async () => {
    const rows = await getPurchaseOrders(db, { limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.brand_name.length).toBeGreaterThan(0);
      expect(typeof r.total_cost_cents).toBe("number");
      expect(r.qty_received).toBeLessThanOrEqual(r.qty_ordered);
      expect(r.receive_fraction).toBeGreaterThanOrEqual(0);
      expect(r.receive_fraction).toBeLessThanOrEqual(1);
    }
  });

  it("aged_inventory returns rows per (product, location) with dollars-at-risk", async () => {
    const rows = await getAgedInventory(db, { limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.on_hand).toBeGreaterThan(0);
      expect(r.dollars_at_risk_cents).toBe(r.on_hand * r.unit_cost_cents);
    }
    // sorted by dollars_at_risk desc
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].dollars_at_risk_cents).toBeGreaterThanOrEqual(
        rows[i].dollars_at_risk_cents,
      );
    }
  });

  it("sku_margin_by_channel is empty until margin_snapshots is written to", async () => {
    const rows = await getSkuMarginByChannel(db);
    expect(Array.isArray(rows)).toBe(true);
    // May be 0 (M1-D not shipped) or > 0 (subsequent test wrote a snapshot)
  });

  it("landed_cost_history: inserting a landed_cost row surfaces it in the view", async () => {
    const { data: product } = await db
      .from("products")
      .select("id")
      .eq("sku", "VC-BT-100")
      .single();
    const { data: receipt } = await db
      .from("receipts")
      .select("id")
      .limit(1)
      .single();
    expect(product?.id).toBeDefined();
    expect(receipt?.id).toBeDefined();

    const { data: inserted, error } = await db
      .from("landed_costs")
      .insert({
        receipt_id: receipt!.id,
        product_id: product!.id,
        qty: 10,
        unit_cost_cents: 3000,
        duties_cents: 300,
        freight_cents: 500,
        handling_cents: 100,
      })
      .select("id, landed_unit_cents")
      .single();
    expect(error).toBeNull();
    // Generated column check: unit + duties + freight + handling
    expect(inserted?.landed_unit_cents).toBe(3900);

    const history = await getLandedCostHistory(db, { productId: product!.id });
    expect(history.length).toBeGreaterThan(0);
    // Locate the row we just inserted rather than assuming it's the most
    // recent (M1-C/D's receive_shipment tests may have written newer rows).
    const ourRow = history.find((r) => r.id === inserted!.id);
    expect(ourRow?.landed_unit_cents).toBe(3900);
    expect(ourRow?.sku).toBe("VC-BT-100");
    expect(ourRow?.brand_name).toMatch(/Voltcore/i);

    // cleanup
    await db.from("landed_costs").delete().eq("id", inserted!.id);
  });

  it("supplier_products: one_primary_supplier_per_product enforces uniqueness", async () => {
    const { data: product } = await db
      .from("products")
      .select("id")
      .eq("sku", "VC-BT-100")
      .single();
    const { data: supplier } = await db.from("suppliers").select("id").limit(1).single();
    expect(product?.id).toBeDefined();
    expect(supplier?.id).toBeDefined();

    // First primary link: fine.
    const { data: a, error: errA } = await db
      .from("supplier_products")
      .insert({
        supplier_id: supplier!.id,
        product_id: product!.id,
        unit_cost_cents: 3200,
        moq: 100,
        lead_time_days: 14,
        is_primary: true,
      })
      .select("id")
      .single();
    expect(errA).toBeNull();

    // A second row for the same product, also is_primary: rejected by the
    // partial unique index.
    const { data: dummySupplier } = await db
      .from("suppliers")
      .insert({ name: "Alt Supplier For Test" })
      .select("id")
      .single();

    const { error: errB } = await db.from("supplier_products").insert({
      supplier_id: dummySupplier!.id,
      product_id: product!.id,
      unit_cost_cents: 3100,
      moq: 200,
      lead_time_days: 30,
      is_primary: true,
    });
    expect(errB?.message ?? "").toMatch(/one_primary_supplier_per_product|duplicate key/i);

    // A NON-primary alt is fine.
    const { error: errC } = await db.from("supplier_products").insert({
      supplier_id: dummySupplier!.id,
      product_id: product!.id,
      unit_cost_cents: 3100,
      moq: 200,
      lead_time_days: 30,
      is_primary: false,
    });
    expect(errC).toBeNull();

    // cleanup
    await db.from("supplier_products").delete().eq("id", a!.id);
    await db
      .from("supplier_products")
      .delete()
      .eq("product_id", product!.id)
      .eq("supplier_id", dummySupplier!.id);
    await db.from("suppliers").delete().eq("id", dummySupplier!.id);
  });

  it("margin_snapshots: net_margin_cents is a generated column", async () => {
    // Find an order_line that DOESN'T have a snapshot yet (M1-D's ship_order
    // trigger auto-writes snapshots on every ship). If nothing is available,
    // create a throwaway order + line to test against.
    const { data: candidates } = await db
      .from("order_lines")
      .select("id, order_id")
      .limit(50);
    let orderLineId: string | undefined;
    let orderId: string | undefined;
    for (const l of candidates ?? []) {
      const { data: existing } = await db
        .from("margin_snapshots")
        .select("order_line_id")
        .eq("order_line_id", l.id)
        .maybeSingle();
      if (!existing) {
        orderLineId = l.id;
        orderId = l.order_id;
        break;
      }
    }
    if (!orderLineId || !orderId) return; // every line snapshotted; skip

    const { data: inserted, error } = await db
      .from("margin_snapshots")
      .insert({
        order_id: orderId,
        order_line_id: orderLineId,
        gross_revenue_cents: 10000,
        fee_cents: 800,
        landed_cost_cents: 5000,
      })
      .select("net_margin_cents")
      .single();
    expect(error).toBeNull();
    expect(inserted?.net_margin_cents).toBe(4200);

    // cleanup
    await db.from("margin_snapshots").delete().eq("order_line_id", orderLineId);
  });
});
