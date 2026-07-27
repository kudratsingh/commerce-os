import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * Domain wrappers for the Module 4 CRM RPCs (migration 015).
 *
 * `register_touchpoint` appends a touchpoint fact and derives the parent
 * creator's status transition.
 * `ship_sample` is the pivot: sample_requests → stock_movements +
 * stock_levels update + creator_touchpoints entry, all in one tx.
 *
 * See `docs/adr/ADR-012-append-only-touchpoints.md`.
 */

// ----------------------------------------------------------------------------
// register_touchpoint
// ----------------------------------------------------------------------------

export const touchpointKindSchema = z.enum([
  "outreach",
  "reply",
  "call",
  "meeting",
  "sample_request",
  "sample_ship",
  "contract",
  "payment",
  "other",
]);
export type TouchpointKind = z.infer<typeof touchpointKindSchema>;

export const touchpointDirectionSchema = z.enum(["outbound", "inbound"]);
export type TouchpointDirection = z.infer<typeof touchpointDirectionSchema>;

export const creatorStatusSchema = z.enum([
  "prospect",
  "contacted",
  "replied",
  "accepted",
  "active",
  "declined",
  "blocked",
]);
export type CreatorStatus = z.infer<typeof creatorStatusSchema>;

const registerTouchpointOutcomeSchema = z.object({
  touchpoint_id: z.number().int(),
  creator_id: z.string().uuid(),
  previous_status: creatorStatusSchema,
  new_status: creatorStatusSchema,
});
export type RegisterTouchpointOutcome = z.infer<typeof registerTouchpointOutcomeSchema>;

export interface RegisterTouchpointInput {
  creatorId: string;
  kind: TouchpointKind;
  direction: TouchpointDirection;
  medium?: string;
  notes?: string;
  actor?: string;
  occurredAt?: string; // ISO 8601; defaults to now() server-side
}

export async function registerTouchpoint(
  db: Db,
  input: RegisterTouchpointInput,
): Promise<RegisterTouchpointOutcome> {
  const { data, error } = await db.rpc("register_touchpoint", {
    p_creator_id: input.creatorId,
    p_kind: input.kind,
    p_direction: input.direction,
    p_medium: input.medium,
    p_notes: input.notes,
    p_actor: input.actor,
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });
  if (error) throw new Error(`register_touchpoint failed: ${error.message}`);
  const parsed = registerTouchpointOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `register_touchpoint returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ----------------------------------------------------------------------------
// ship_sample
// ----------------------------------------------------------------------------

const shipSampleOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("shipped"),
    sample_request_id: z.string().uuid(),
    stock_movement_id: z.number().int(),
    qty: z.number().int().positive(),
  }),
  z.object({
    outcome: z.literal("already_shipped"),
    sample_request_id: z.string().uuid(),
    status: z.string(),
  }),
]);
export type ShipSampleOutcome = z.infer<typeof shipSampleOutcomeSchema>;

export interface ShipSampleInput {
  sampleRequestId: string;
  locationId: string;
  trackingNumber?: string;
  shippedBy?: string;
}

export async function shipSample(
  db: Db,
  input: ShipSampleInput,
): Promise<ShipSampleOutcome> {
  const { data, error } = await db.rpc("ship_sample", {
    p_sample_request_id: input.sampleRequestId,
    p_location_id: input.locationId,
    p_tracking_number: input.trackingNumber,
    p_shipped_by: input.shippedBy,
  });
  if (error) throw new Error(`ship_sample failed: ${error.message}`);
  const parsed = shipSampleOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `ship_sample returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
