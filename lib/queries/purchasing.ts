import type { Db } from "@/lib/db/server";

/**
 * purchase_orders_dashboard (view, migration 008) — PO list read model.
 * The /purchasing list page in M1-B renders directly from this shape.
 */

export type POStatus =
  | "draft"
  | "placed"
  | "partially_received"
  | "received"
  | "closed";

export interface PurchaseOrderRow {
  id: string;
  brand_id: string;
  brand_name: string;
  supplier_id: string | null;
  supplier_name: string | null;
  status: POStatus;
  expected_at: string | null;
  created_at: string;
  line_count: number;
  qty_ordered: number;
  total_cost_cents: number;
  qty_received: number;
  receive_fraction: number;
  days_outstanding: number;
}

export interface PurchaseOrdersFilter {
  status?: POStatus | POStatus[];
  brandId?: string;
  supplierId?: string;
  limit?: number;
}

export async function getPurchaseOrders(
  db: Db,
  filter: PurchaseOrdersFilter = {},
): Promise<PurchaseOrderRow[]> {
  let q = db
    .from("purchase_orders_dashboard")
    .select(
      "id, brand_id, brand_name, supplier_id, supplier_name, status, expected_at, created_at, line_count, qty_ordered, total_cost_cents, qty_received, receive_fraction, days_outstanding",
    );

  if (filter.status !== undefined) {
    q = Array.isArray(filter.status)
      ? q.in("status", filter.status)
      : q.eq("status", filter.status);
  }
  if (filter.brandId) q = q.eq("brand_id", filter.brandId);
  if (filter.supplierId) q = q.eq("supplier_id", filter.supplierId);

  q = q.order("created_at", { ascending: false }).limit(filter.limit ?? 100);

  const { data, error } = await q;
  if (error) {
    throw new Error(`purchase_orders_dashboard read failed: ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
    supplier_id: r.supplier_id ?? null,
    supplier_name: r.supplier_name ?? null,
    status: (r.status ?? "placed") as POStatus,
    expected_at: r.expected_at ?? null,
    created_at: r.created_at ?? new Date(0).toISOString(),
    line_count: r.line_count ?? 0,
    qty_ordered: r.qty_ordered ?? 0,
    total_cost_cents: Number(r.total_cost_cents ?? 0),
    qty_received: r.qty_received ?? 0,
    receive_fraction: Number(r.receive_fraction ?? 0),
    days_outstanding: Number(r.days_outstanding ?? 0),
  }));
}

/**
 * aged_inventory (view, migration 008) — capital tied up in SKUs that
 * stopped moving. Sorted by dollars_at_risk descending so ops sees the
 * biggest offenders first.
 */

export interface AgedInventoryRow {
  product_id: string;
  sku: string;
  title: string;
  brand_id: string;
  brand_name: string;
  location_id: string;
  location_name: string;
  on_hand: number;
  last_shipped_at: string | null;
  days_since_last_shipment: number;
  unit_cost_cents: number;
  dollars_at_risk_cents: number;
}

export async function getAgedInventory(
  db: Db,
  opts: { minDays?: number; limit?: number } = {},
): Promise<AgedInventoryRow[]> {
  let q = db
    .from("aged_inventory")
    .select(
      "product_id, sku, title, brand_id, brand_name, location_id, location_name, on_hand, last_shipped_at, days_since_last_shipment, unit_cost_cents, dollars_at_risk_cents",
    );

  if (opts.minDays !== undefined) {
    q = q.gte("days_since_last_shipment", opts.minDays);
  }
  q = q.order("dollars_at_risk_cents", { ascending: false }).limit(opts.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(`aged_inventory read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    product_id: r.product_id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
    location_id: r.location_id ?? "",
    location_name: r.location_name ?? "",
    on_hand: r.on_hand ?? 0,
    last_shipped_at: r.last_shipped_at ?? null,
    days_since_last_shipment: Number(r.days_since_last_shipment ?? 0),
    unit_cost_cents: Number(r.unit_cost_cents ?? 0),
    dollars_at_risk_cents: Number(r.dollars_at_risk_cents ?? 0),
  }));
}
