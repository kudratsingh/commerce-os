import { z } from "zod";

import type { Db } from "@/lib/db/server";

/**
 * RPC wrappers for reconciliation (migration 001 + 005).
 * The panel calls these; the RPCs enforce the invariants.
 */

const resolveOutcomeSchema = z.object({
  outcome: z.enum(["resolved", "already_resolved"]),
  finding_id: z.number().int(),
});

export type ResolveOutcome = z.infer<typeof resolveOutcomeSchema>;

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
): Promise<ResolveOutcome> {
  const { data, error } = await db.rpc("resolve_reconciliation_finding", {
    p_finding_id: findingId,
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
