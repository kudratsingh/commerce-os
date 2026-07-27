import { z } from "zod";

/**
 * ESI/ERP webhook payload schemas (migration 013, ADR-011).
 *
 * The ESI feed carries physical-truth events — cycle counts, transfers,
 * damage — that ONLY ESI can produce. Our system is a consumer here.
 *
 * Contract shape mirrors the tiktok webhook: `event_id` for dedupe,
 * `event_type` as discriminator, everything else typed by the union arm.
 */

const baseSchema = z.object({
  event_id: z.string().min(1).max(200),
  emitted_at: z.string().datetime().optional(),
});

const stockCountedSchema = baseSchema.extend({
  event_type: z.literal("stock.counted"),
  stock: z.object({
    external_sku: z.string().min(1),
    location: z.string().min(1),
    counted_qty: z.number().int().nonnegative(),
  }),
});

const stockTransferredSchema = baseSchema.extend({
  event_type: z.literal("stock.transferred"),
  transfer: z.object({
    external_sku: z.string().min(1),
    from_location: z.string().min(1),
    to_location: z.string().min(1),
    qty: z.number().int().positive(),
  }),
});

const stockDamagedSchema = baseSchema.extend({
  event_type: z.literal("stock.damaged"),
  damage: z.object({
    external_sku: z.string().min(1),
    location: z.string().min(1),
    qty: z.number().int().positive(),
    note: z.string().max(200).optional(),
  }),
});

export const erpWebhookPayloadSchema = z.discriminatedUnion("event_type", [
  stockCountedSchema,
  stockTransferredSchema,
  stockDamagedSchema,
]);

export type ErpWebhookPayload = z.infer<typeof erpWebhookPayloadSchema>;
