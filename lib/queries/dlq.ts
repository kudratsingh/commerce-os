import type { Db } from "@/lib/db/server";

/**
 * dlq_events (view, migration 004) — failed + dead webhook events with a
 * pre-extracted external_order_id for cross-linking.
 */

export type DlqStatus = "failed" | "dead";

export interface DlqRow {
  id: string;
  channel_id: string;
  external_event_id: string;
  event_type: string;
  status: DlqStatus;
  signature_valid: boolean;
  attempts: number;
  last_error: string | null;
  received_at: string;
  external_order_id: string | null;
}

export async function getDlqEvents(db: Db, limit = 25): Promise<DlqRow[]> {
  const { data, error } = await db
    .from("dlq_events")
    .select(
      "id, channel_id, external_event_id, event_type, status, signature_valid, attempts, last_error, received_at, external_order_id",
    )
    .limit(limit);
  if (error) throw new Error(`dlq_events read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    channel_id: r.channel_id ?? "",
    external_event_id: r.external_event_id ?? "",
    event_type: r.event_type ?? "",
    status: (r.status ?? "failed") as DlqStatus,
    signature_valid: r.signature_valid ?? false,
    attempts: r.attempts ?? 0,
    last_error: r.last_error ?? null,
    received_at: r.received_at ?? new Date(0).toISOString(),
    external_order_id: r.external_order_id ?? null,
  }));
}
