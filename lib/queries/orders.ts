import type { Db } from "@/lib/db/server";

/**
 * recent_orders (view, migration 004) — orders + brand name joined,
 * ordered by placed_at desc for the live feed's initial paint. After the
 * page loads, Realtime takes over via the browser client subscribing to
 * postgres_changes on the orders table.
 */

export type OrderStatus =
  | "received"
  | "allocated"
  | "backordered"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface OrderRow {
  id: string;
  channel_id: string;
  external_order_id: string;
  status: OrderStatus;
  buyer_handle: string | null;
  subtotal_cents: number;
  placed_at: string;
  created_at: string;
  brand_id: string;
  brand_name: string;
}

export async function getRecentOrders(db: Db, limit = 40): Promise<OrderRow[]> {
  const { data, error } = await db
    .from("recent_orders")
    .select(
      "id, channel_id, external_order_id, status, buyer_handle, subtotal_cents, placed_at, created_at, brand_id, brand_name",
    )
    .order("placed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recent_orders read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    channel_id: r.channel_id ?? "",
    external_order_id: r.external_order_id ?? "",
    status: (r.status ?? "received") as OrderStatus,
    buyer_handle: r.buyer_handle ?? null,
    subtotal_cents: r.subtotal_cents ?? 0,
    placed_at: r.placed_at ?? new Date(0).toISOString(),
    created_at: r.created_at ?? new Date(0).toISOString(),
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
  }));
}
