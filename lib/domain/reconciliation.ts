import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * RPC wrappers for reconciliation (migration 001 + 005).
 * The panel calls these; the RPCs enforce the invariants.
 */

const resolveOutcomeSchema = z.object({
  outcome: z.enum(["resolved", "already_resolved"]),
  finding_id: z.number().int(),
  strategy: z.enum(["ack", "accept_source"]).optional(),
});

export type ResolveOutcome = z.infer<typeof resolveOutcomeSchema>;
export type ResolveStrategy = "ack" | "accept_source";

const skewOutcomeSchema = z.object({
  outcome: z.literal("skewed"),
  channel_id: z.string(),
  product_id: z.string().uuid(),
  available: z.number().int().nullable(),
  reported: z.number().int(),
  delta: z.number().int(),
});

export type SkewOutcome = z.infer<typeof skewOutcomeSchema>;

export async function runReconciliation(db: Db): Promise<string> {
  const { data, error } = await db.rpc("run_reconciliation");
  if (error) throw new Error(`run_reconciliation failed: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error("run_reconciliation returned unexpected shape");
  }
  return data;
}

export async function resolveFinding(
  db: Db,
  findingId: number,
  strategy: ResolveStrategy = "ack",
  note?: string,
): Promise<ResolveOutcome> {
  const { data, error } = await db.rpc("resolve_reconciliation_finding", {
    p_finding_id: findingId,
    p_strategy: strategy,
    p_note: note ?? null,
  });
  if (error)
    throw new Error(`resolve_reconciliation_finding failed: ${error.message}`);
  const parsed = resolveOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `resolve_reconciliation_finding returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * `skew_erp_report` — chaos helper for the ESI side. Reports an on_hand value
 * that disagrees with our stock_levels by `delta`; the next `run_reconciliation`
 * surfaces it as an `erp_drift` finding with authority inverted (ESI expected,
 * ours actual). See ADR-011.
 */
const skewErpOutcomeSchema = z.object({
  outcome: z.literal("skewed"),
  product_id: z.string().uuid(),
  location_id: z.string().uuid(),
  our_on_hand: z.number().int().nullable(),
  reported: z.number().int(),
  delta: z.number().int(),
});
export type SkewErpOutcome = z.infer<typeof skewErpOutcomeSchema>;

export async function skewErpReport(
  db: Db,
  args: { sku: string; location: string; delta: number },
): Promise<SkewErpOutcome> {
  const { data, error } = await db.rpc("skew_erp_report", {
    p_sku: args.sku,
    p_location: args.location,
    p_delta: args.delta,
  });
  if (error) throw new Error(`skew_erp_report failed: ${error.message}`);
  const parsed = skewErpOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `skew_erp_report returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function skewChannelReport(
  db: Db,
  args: { channelId: string; sku: string; delta: number },
): Promise<SkewOutcome> {
  const { data, error } = await db.rpc("skew_channel_report", {
    p_channel_id: args.channelId,
    p_sku: args.sku,
    p_delta: args.delta,
  });
  if (error) throw new Error(`skew_channel_report failed: ${error.message}`);
  const parsed = skewOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `skew_channel_report returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
