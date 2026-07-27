import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * RPC wrapper for `process_order_event` (see migration 003).
 * The whole ingestion pipeline — dedupe, upsert, allocate, outbox write,
 * event bookkeeping — happens in one DB round trip so ADR-001..004 hold
 * without app-layer heroics.
 *
 * The function returns jsonb; we zod-parse it so a stale/renamed RPC surfaces
 * immediately instead of a mystery runtime error weeks later.
 */

export const processEventOutcomeSchema = z.object({
  outcome: z.enum([
    "deduped",
    "allocated",
    "backordered",
    "cancelled",
    "shipped",
    "returned",
    "delivered",
    "bad_signature",
    "failed",
  ]),
  event_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  reason: z.string().optional(),
});

export type ProcessEventOutcome = z.infer<typeof processEventOutcomeSchema>;

export interface ProcessEventArgs {
  channelId: string;
  externalEventId: string;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
  locationId: string;
}

export async function processOrderEvent(
  db: Db,
  args: ProcessEventArgs,
): Promise<ProcessEventOutcome> {
  const { data, error } = await db.rpc("process_order_event", {
    p_channel_id: args.channelId,
    p_external_event_id: args.externalEventId,
    p_event_type: args.eventType,
    p_payload: args.payload as never,
    p_signature_valid: args.signatureValid,
    p_location_id: args.locationId,
  });
  if (error) {
    throw new Error(`process_order_event RPC failed: ${error.message}`);
  }
  const parsed = processEventOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `process_order_event returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
