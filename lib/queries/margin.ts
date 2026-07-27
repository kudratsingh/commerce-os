import type { Db } from "@/lib/db/server";

/**
 * sku_margin_by_channel (view, migration 008) — 30-day rolling margin
 * per SKU per channel. Empty until margin_snapshots gets written to
 * (M1-D adds the ship-time trigger).
 */

export interface SkuMarginRow {
  channel_id: string;
  product_id: string;
  sku: string;
  title: string;
  brand_id: string;
  brand_name: string;
  orders_in_window: number;
  avg_gross_revenue_cents: number;
  avg_fee_cents: number;
  avg_landed_cost_cents: number;
  avg_net_margin_cents: number;
  net_margin_pct: number | null;
}

export interface SkuMarginFilter {
  brandId?: string;
  channelId?: string;
  limit?: number;
}

export async function getSkuMarginByChannel(
  db: Db,
  filter: SkuMarginFilter = {},
): Promise<SkuMarginRow[]> {
  let q = db
    .from("sku_margin_by_channel")
    .select(
      "channel_id, product_id, sku, title, brand_id, brand_name, orders_in_window, avg_gross_revenue_cents, avg_fee_cents, avg_landed_cost_cents, avg_net_margin_cents, net_margin_pct",
    );

  if (filter.brandId) q = q.eq("brand_id", filter.brandId);
  if (filter.channelId) q = q.eq("channel_id", filter.channelId);
  q = q.order("avg_net_margin_cents", { ascending: false }).limit(filter.limit ?? 200);

  const { data, error } = await q;
  if (error) throw new Error(`sku_margin_by_channel read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    channel_id: r.channel_id ?? "",
    product_id: r.product_id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
    orders_in_window: Number(r.orders_in_window ?? 0),
    avg_gross_revenue_cents: Number(r.avg_gross_revenue_cents ?? 0),
    avg_fee_cents: Number(r.avg_fee_cents ?? 0),
    avg_landed_cost_cents: Number(r.avg_landed_cost_cents ?? 0),
    avg_net_margin_cents: Number(r.avg_net_margin_cents ?? 0),
    net_margin_pct: r.net_margin_pct !== null ? Number(r.net_margin_pct) : null,
  }));
}

/**
 * landed_cost_history (view, migration 008) — per-receipt landed cost
 * timeline for the SKU detail chart. Component breakdown (unit + duties
 * + freight + handling) so ops can see why a receipt was priced how it was.
 */

export interface LandedCostRow {
  id: string;
  receipt_id: string;
  product_id: string;
  sku: string;
  title: string;
  brand_name: string;
  qty: number;
  unit_cost_cents: number;
  duties_cents: number;
  freight_cents: number;
  handling_cents: number;
  landed_unit_cents: number;
  received_at: string;
  location_id: string;
  location_name: string;
}

export async function getLandedCostHistory(
  db: Db,
  opts: { productId?: string; limit?: number } = {},
): Promise<LandedCostRow[]> {
  let q = db
    .from("landed_cost_history")
    .select(
      "id, receipt_id, product_id, sku, title, brand_name, qty, unit_cost_cents, duties_cents, freight_cents, handling_cents, landed_unit_cents, received_at, location_id, location_name",
    );

  if (opts.productId) q = q.eq("product_id", opts.productId);
  q = q.order("received_at", { ascending: false }).limit(opts.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(`landed_cost_history read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    receipt_id: r.receipt_id ?? "",
    product_id: r.product_id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_name: r.brand_name ?? "",
    qty: Number(r.qty ?? 0),
    unit_cost_cents: Number(r.unit_cost_cents ?? 0),
    duties_cents: Number(r.duties_cents ?? 0),
    freight_cents: Number(r.freight_cents ?? 0),
    handling_cents: Number(r.handling_cents ?? 0),
    landed_unit_cents: Number(r.landed_unit_cents ?? 0),
    received_at: r.received_at ?? new Date(0).toISOString(),
    location_id: r.location_id ?? "",
    location_name: r.location_name ?? "",
  }));
}
