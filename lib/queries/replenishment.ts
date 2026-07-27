import type { Db } from "@/lib/db/server";

/**
 * replenishment_alerts (view, migration 010) — SKUs where urgency > ok.
 *
 * Urgency levels:
 *   'expedite' — available <= min_qty. Fire drill.
 *   'reorder'  — days-of-cover < supplier lead time. Buy now.
 *   'watch'    — below target but not urgent.
 *   'ok'       — filtered out; not returned by this view.
 */

export type Urgency = "expedite" | "reorder" | "watch";

export interface ReplenishmentAlertRow {
  product_id: string;
  sku: string;
  title: string;
  brand_id: string;
  brand_name: string;
  location_id: string;
  location_name: string;
  on_hand: number;
  committed: number;
  available: number;
  min_qty: number | null;
  target_qty: number | null;
  units_shipped_window: number;
  velocity_per_day: number;
  days_of_cover: number | null;
  primary_supplier_id: string | null;
  primary_supplier_name: string | null;
  primary_unit_cost_cents: number | null;
  primary_lead_time_days: number | null;
  primary_moq: number | null;
  recommended_qty: number | null;
  urgency: Urgency;
}

export async function getReplenishmentAlerts(
  db: Db,
  filter: { brandId?: string; urgency?: Urgency | Urgency[]; limit?: number } = {},
): Promise<ReplenishmentAlertRow[]> {
  let q = db
    .from("replenishment_alerts")
    .select(
      "product_id, sku, title, brand_id, brand_name, location_id, location_name, on_hand, committed, available, min_qty, target_qty, units_shipped_window, velocity_per_day, days_of_cover, primary_supplier_id, primary_supplier_name, primary_unit_cost_cents, primary_lead_time_days, primary_moq, recommended_qty, urgency",
    );

  if (filter.brandId) q = q.eq("brand_id", filter.brandId);
  if (filter.urgency) {
    q = Array.isArray(filter.urgency)
      ? q.in("urgency", filter.urgency)
      : q.eq("urgency", filter.urgency);
  }

  q = q
    .order(
      "urgency",
      { ascending: true }, // expedite < ok alphabetically; sort by urgency ordinal in app
    )
    .limit(filter.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(`replenishment_alerts read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    product_id: r.product_id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
    location_id: r.location_id ?? "",
    location_name: r.location_name ?? "",
    on_hand: r.on_hand ?? 0,
    committed: r.committed ?? 0,
    available: r.available ?? 0,
    min_qty: r.min_qty,
    target_qty: r.target_qty,
    units_shipped_window: r.units_shipped_window ?? 0,
    velocity_per_day: Number(r.velocity_per_day ?? 0),
    days_of_cover: r.days_of_cover !== null ? Number(r.days_of_cover) : null,
    primary_supplier_id: r.primary_supplier_id,
    primary_supplier_name: r.primary_supplier_name,
    primary_unit_cost_cents: r.primary_unit_cost_cents,
    primary_lead_time_days: r.primary_lead_time_days,
    primary_moq: r.primary_moq,
    recommended_qty: r.recommended_qty,
    urgency: (r.urgency ?? "watch") as Urgency,
  }));
}

// ----------------------------------------------------------------------------
// Small helpers for the /purchasing/new form
// ----------------------------------------------------------------------------

export interface SupplierOption {
  id: string;
  name: string;
}

export async function getSuppliers(db: Db): Promise<SupplierOption[]> {
  const { data, error } = await db
    .from("suppliers")
    .select("id, name")
    .order("name");
  if (error) throw new Error(`suppliers read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    name: r.name ?? "",
  }));
}

export interface BrandOption {
  id: string;
  name: string;
}

export async function getBrands(db: Db): Promise<BrandOption[]> {
  const { data, error } = await db.from("brands").select("id, name").order("name");
  if (error) throw new Error(`brands read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    name: r.name ?? "",
  }));
}

export interface ProductOption {
  id: string;
  sku: string;
  title: string;
  brand_id: string;
  cost_cents: number;
}

export async function getProducts(
  db: Db,
  filter: { brandId?: string } = {},
): Promise<ProductOption[]> {
  let q = db
    .from("products")
    .select("id, sku, title, brand_id, cost_cents")
    .order("sku");
  if (filter.brandId) q = q.eq("brand_id", filter.brandId);
  const { data, error } = await q;
  if (error) throw new Error(`products read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_id: r.brand_id ?? "",
    cost_cents: r.cost_cents ?? 0,
  }));
}
