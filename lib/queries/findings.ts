import type { Db } from "@/lib/db/server";

/**
 * open_findings (view, migration 005) — reconciliation findings that need
 * ops attention, joined to product / brand / location names.
 */

export interface FindingRow {
  id: number;
  run_id: string;
  kind: "ledger_drift" | "channel_drift" | "erp_drift";
  product_id: string;
  sku: string;
  title: string;
  brand_name: string;
  location_id: string | null;
  location_name: string | null;
  channel_id: string | null;
  expected: number;
  actual: number;
  delta: number;
  created_at: string;
}

export async function getOpenFindings(db: Db, limit = 50): Promise<FindingRow[]> {
  const { data, error } = await db
    .from("open_findings")
    .select(
      "id, run_id, kind, product_id, sku, title, brand_name, location_id, location_name, channel_id, expected, actual, delta, created_at",
    )
    .limit(limit);
  if (error) throw new Error(`open_findings read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? 0,
    run_id: r.run_id ?? "",
    kind: (r.kind ?? "channel_drift") as FindingRow["kind"],
    product_id: r.product_id ?? "",
    sku: r.sku ?? "",
    title: r.title ?? "",
    brand_name: r.brand_name ?? "",
    location_id: r.location_id ?? null,
    location_name: r.location_name ?? null,
    channel_id: r.channel_id ?? null,
    expected: r.expected ?? 0,
    actual: r.actual ?? 0,
    delta: r.delta ?? 0,
    created_at: r.created_at ?? new Date(0).toISOString(),
  }));
}

export interface ReconRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  findings_count: number | null;
  elapsed_ms: number | null;
}

export async function getRecentReconRuns(db: Db, limit = 10): Promise<ReconRunRow[]> {
  const { data, error } = await db
    .from("recent_recon_runs")
    .select("id, started_at, finished_at, findings_count, elapsed_ms")
    .limit(limit);
  if (error) throw new Error(`recent_recon_runs read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    started_at: r.started_at ?? new Date(0).toISOString(),
    finished_at: r.finished_at ?? null,
    findings_count: r.findings_count ?? null,
    elapsed_ms: r.elapsed_ms ? Number(r.elapsed_ms) : null,
  }));
}
