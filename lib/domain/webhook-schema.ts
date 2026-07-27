import { z } from "zod";

/**
 * The webhook contract Commerce OS speaks with every marketplace adapter.
 * Documented in BUILD_PLAN.md; the simulator produces payloads of this shape
 * so the demo exercises the real ingestion path.
 *
 * Everything is validated with `safeParse` before touching the database
 * (CLAUDE.md invariant #6). Money and quantities are integer cents / units.
 */

export const webhookLineSchema = z.object({
  external_sku: z.string().min(1),
  qty: z.number().int().positive(),
  unit_price_cents: z.number().int().nonnegative(),
});

export const webhookOrderSchema = z.object({
  external_order_id: z.string().min(1),
  buyer_handle: z.string().optional(),
  placed_at: z.string().datetime({ offset: true }),
  lines: z.array(webhookLineSchema).min(1),
});

export const webhookEventTypeSchema = z.enum([
  "order.created",
  "order.cancelled",
  "order.shipped",
  "order.returned",
]);

export const webhookPayloadSchema = z.object({
  event_id: z.string().min(1),
  event_type: webhookEventTypeSchema,
  occurred_at: z.string().datetime({ offset: true }),
  order: webhookOrderSchema,
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookLine = z.infer<typeof webhookLineSchema>;
export type WebhookOrder = z.infer<typeof webhookOrderSchema>;
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;
