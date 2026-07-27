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
