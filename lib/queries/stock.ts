import type { Db } from "@/lib/db/server";

/**
 * stock_dashboard (view, migration 004) — product+location rollup with
 * derived `available` and `low_stock` flag.
 */

export interface StockRow {
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
  low_stock: boolean;
  price_cents: number;
}

export async function getStockLevels(db: Db, limit = 200): Promise<StockRow[]> {
  const { data, error } = await db
    .from("stock_dashboard")
    .select(
      "product_id, sku, title, brand_id, brand_name, location_id, location_name, on_hand, committed, available, low_stock, price_cents",
    )
    .order("low_stock", { ascending: false })
    .order("brand_name", { ascending: true })
    .order("sku", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`stock_dashboard read failed: ${error.message}`);
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
    low_stock: r.low_stock ?? false,
    price_cents: r.price_cents ?? 0,
  }));
}
