import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * Thin RPC wrappers for the outbox sweeper (migration 003).
 *
 * `outbox_deliver_batch` atomically claims a batch of due rows via
 * FOR UPDATE SKIP LOCKED and marks them delivered — safe under overlapping
 * cron firings. See docs/architecture.md §Layer 5 for why the queue is a
 * table and the worker is a cron-fired isolate.
 */

const outboxDeliverySchema = z.object({
  id: z.number().int(),
  event_type: z.string(),
  aggregate_id: z.string().uuid().nullable(),
  payload: z.unknown(),
});

const outboxDeliveryListSchema = z.array(outboxDeliverySchema);

export type OutboxDelivery = z.infer<typeof outboxDeliverySchema>;

export async function deliverOutboxBatch(
  db: Db,
  limit = 50,
): Promise<OutboxDelivery[]> {
  const { data, error } = await db.rpc("outbox_deliver_batch", {
    p_limit: limit,
  });
  if (error) {
    throw new Error(`outbox_deliver_batch failed: ${error.message}`);
  }
  const parsed = outboxDeliveryListSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error(
      `outbox_deliver_batch returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function markOutboxFailed(
  db: Db,
  id: number,
  reason: string,
): Promise<"failed" | "dead"> {
  const { data, error } = await db.rpc("outbox_mark_failed", {
    p_id: id,
    p_error: reason,
  });
  if (error) {
    throw new Error(`outbox_mark_failed failed: ${error.message}`);
  }
  if (data !== "failed" && data !== "dead") {
    throw new Error(`outbox_mark_failed returned unknown status: ${data}`);
  }
  return data;
}

/**
 * Two-phase claim: atomically flip a batch to `in_flight` and return them
 * so the sweeper can dispatch to an external handler (marketplace adapter)
 * and then mark delivered/failed after the wire call returns. Migration 012.
 */
export async function claimOutboxBatch(
  db: Db,
  limit = 50,
): Promise<OutboxDelivery[]> {
  const { data, error } = await db.rpc("outbox_claim_batch", {
    p_limit: limit,
  });
  if (error) {
    throw new Error(`outbox_claim_batch failed: ${error.message}`);
  }
  const parsed = outboxDeliveryListSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error(
      `outbox_claim_batch returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function markOutboxDelivered(db: Db, id: number): Promise<void> {
  const { error } = await db.rpc("outbox_mark_delivered", { p_id: id });
  if (error) {
    throw new Error(`outbox_mark_delivered failed: ${error.message}`);
  }
}

/**
 * Payload shape for `inventory.sync` events (both sync-on-change and
 * reconciliation-push emit this shape).
 */
const inventorySyncPayloadSchema = z.object({
  channel_id: z.string(),
  product_id: z.string().uuid(),
  correct_qty: z.number().int(),
  source: z.enum(["stock_change", "reconciliation"]).optional(),
  finding_id: z.number().int().optional(),
});

export type InventorySyncPayload = z.infer<typeof inventorySyncPayloadSchema>;

export function parseInventorySyncPayload(
  raw: unknown,
): InventorySyncPayload | null {
  const parsed = inventorySyncPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
