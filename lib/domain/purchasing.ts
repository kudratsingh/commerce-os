import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * RPC wrappers for purchasing + replenishment operations (migrations
 * 009 + 010). Same zod-parse-on-return discipline as the ingestion
 * wrappers — a renamed RPC surfaces immediately.
 */

// ----------------------------------------------------------------------------
// create_purchase_order
// ----------------------------------------------------------------------------

export const poLineSchema = z.object({
  product_id: z.string().uuid(),
  qty_ordered: z.number().int().positive(),
  unit_cost_cents: z.number().int().nonnegative(),
});

export type POLineInput = z.infer<typeof poLineSchema>;

export interface CreatePOArgs {
  brandId: string;
  supplierId: string;
  expectedAt?: string | null;
  lines: POLineInput[];
  createdBy?: string;
}

export async function createPurchaseOrder(
  db: Db,
  args: CreatePOArgs,
): Promise<string> {
  const { data, error } = await db.rpc("create_purchase_order", {
    p_brand_id: args.brandId,
    p_supplier_id: args.supplierId,
    p_expected_at: args.expectedAt ?? undefined,
    p_lines: args.lines as never,
    p_created_by: args.createdBy ?? "ops",
  });
  if (error) {
    throw new Error(`create_purchase_order RPC failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("create_purchase_order returned unexpected shape");
  }
  return data;
}

// ----------------------------------------------------------------------------
// receive_shipment
// ----------------------------------------------------------------------------

export interface ReceiveShipmentArgs {
  poLineId: string;
  locationId: string;
  qty: number;
  unitCostCents: number;
  dutiesCents?: number;
  freightCents?: number;
  handlingCents?: number;
  receivedBy?: string;
}

export async function receiveShipment(
  db: Db,
  args: ReceiveShipmentArgs,
): Promise<string> {
  const { data, error } = await db.rpc("receive_shipment", {
    p_po_line_id: args.poLineId,
    p_location_id: args.locationId,
    p_qty: args.qty,
    p_unit_cost_cents: args.unitCostCents,
    p_duties_cents: args.dutiesCents ?? 0,
    p_freight_cents: args.freightCents ?? 0,
    p_handling_cents: args.handlingCents ?? 0,
    p_received_by: args.receivedBy ?? "ops",
  });
  if (error) throw new Error(`receive_shipment RPC failed: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error("receive_shipment returned unexpected shape");
  }
  return data;
}

// ----------------------------------------------------------------------------
// close_purchase_order
// ----------------------------------------------------------------------------

const closeOutcomeSchema = z.object({
  outcome: z.enum(["closed", "already_closed"]),
  po_id: z.string().uuid(),
  previous_status: z.string().optional(),
  reason: z.string().nullable().optional(),
});

export type ClosePOOutcome = z.infer<typeof closeOutcomeSchema>;

export async function closePurchaseOrder(
  db: Db,
  poId: string,
  reason?: string,
): Promise<ClosePOOutcome> {
  const { data, error } = await db.rpc("close_purchase_order", {
    p_po_id: poId,
    p_reason: reason ?? undefined,
  });
  if (error) throw new Error(`close_purchase_order failed: ${error.message}`);
  const parsed = closeOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `close_purchase_order returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ----------------------------------------------------------------------------
// upsert_reorder_point
// ----------------------------------------------------------------------------

export interface UpsertReorderPointArgs {
  productId: string;
  locationId: string;
  minQty: number;
  targetQty: number;
  velocityWindow?: string; // Postgres interval literal e.g. '30 days'
}

const upsertReorderOutcomeSchema = z.object({
  outcome: z.literal("saved"),
  product_id: z.string().uuid(),
  location_id: z.string().uuid(),
});

export async function upsertReorderPoint(
  db: Db,
  args: UpsertReorderPointArgs,
): Promise<z.infer<typeof upsertReorderOutcomeSchema>> {
  const { data, error } = await db.rpc("upsert_reorder_point", {
    p_product_id: args.productId,
    p_location_id: args.locationId,
    p_min_qty: args.minQty,
    p_target_qty: args.targetQty,
    p_velocity_window: args.velocityWindow ?? "30 days",
  });
  if (error) throw new Error(`upsert_reorder_point failed: ${error.message}`);
  const parsed = upsertReorderOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `upsert_reorder_point returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
