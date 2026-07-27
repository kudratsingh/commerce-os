import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * RPC wrapper for `retry_webhook_event` (migration 004).
 *
 * The DLQ panel calls this per row after an operator fixes the root cause
 * (typical: add the missing channel_listing for an unknown SKU). Bad-signature
 * events are refused — they represent an attack or misconfig, not a
 * transient failure.
 */

export const retryOutcomeSchema = z.object({
  outcome: z.enum([
    "allocated",
    "backordered",
    "cancelled",
    "already_processed",
    "refused",
    "failed",
  ]),
  event_id: z.string().uuid(),
  order_id: z.string().uuid().optional(),
  reason: z.string().optional(),
});

export type RetryOutcome = z.infer<typeof retryOutcomeSchema>;

export async function retryWebhookEvent(
  db: Db,
  eventId: string,
  locationId: string,
): Promise<RetryOutcome> {
  const { data, error } = await db.rpc("retry_webhook_event", {
    p_event_id: eventId,
    p_location_id: locationId,
  });
  if (error) {
    throw new Error(`retry_webhook_event RPC failed: ${error.message}`);
  }
  const parsed = retryOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `retry_webhook_event returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
