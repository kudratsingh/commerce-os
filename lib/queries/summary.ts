import type { Db } from "@/lib/db/server";

/**
 * dashboard_summary (view, migration 004) — one row with today's totals.
 * SSR renders the stat-card strip from this in a single query.
 */

export interface DashboardSummary {
  gmv_cents: number;
  orders_count: number;
  backordered_count: number;
  received_count: number;
  processed_count: number;
  failed_count: number;
  dead_count: number;
  dlq_count: number;
}

const EMPTY: DashboardSummary = {
  gmv_cents: 0,
  orders_count: 0,
  backordered_count: 0,
  received_count: 0,
  processed_count: 0,
  failed_count: 0,
  dead_count: 0,
  dlq_count: 0,
};

export async function getDashboardSummary(db: Db): Promise<DashboardSummary> {
  const { data, error } = await db
    .from("dashboard_summary")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`dashboard_summary read failed: ${error.message}`);
  if (!data) return EMPTY;
  return {
    gmv_cents: Number(data.gmv_cents ?? 0),
    orders_count: data.orders_count ?? 0,
    backordered_count: data.backordered_count ?? 0,
    received_count: data.received_count ?? 0,
    processed_count: data.processed_count ?? 0,
    failed_count: data.failed_count ?? 0,
    dead_count: data.dead_count ?? 0,
    dlq_count: data.dlq_count ?? 0,
  };
}
