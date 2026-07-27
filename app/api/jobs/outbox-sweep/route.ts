import { NextResponse } from "next/server";

import { getMarketplaceAdapter } from "@/lib/adapters/registry";
import { AdapterRetryableError } from "@/lib/adapters/marketplace-adapter";
import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import {
  claimOutboxBatch,
  markOutboxDelivered,
  markOutboxFailed,
  parseInventorySyncPayload,
} from "@/lib/domain/outbox";

/**
 * POST /api/jobs/outbox-sweep — re-entrant outbox sweeper (ADR-010).
 *
 * Two-phase pattern: claim a batch (rows flip to `in_flight` under
 * FOR UPDATE SKIP LOCKED), dispatch each through the MarketplaceAdapter port
 * for its `event_type`, then mark delivered/failed based on the wire result.
 * Retry curve + DLQ come from `outbox_mark_failed` (migration 003).
 *
 * Two firing modes:
 *   1. Cloudflare Cron Trigger (1/min) — cron-worker/ POSTs with the secret.
 *   2. Manual "Sweep now" button on /simulator.
 *
 * Called under Cloudflare Access via the internal route-handler bypass
 * pattern (PR #7): direct import + call is safe from a co-located server
 * action or another route handler.
 */

const BATCH_LIMIT = 100;

interface DispatchOutcome {
  id: number;
  event_type: string;
  status: "delivered" | "retryable" | "dead" | "permanent";
  reason?: string;
}

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const providedSecret = req.headers.get("x-cron-secret");
  if (providedSecret !== env.WEBHOOK_SHARED_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createSupabaseServer();
  const startedAt = Date.now();
  const claimed = await claimOutboxBatch(db, BATCH_LIMIT);

  const outcomes: DispatchOutcome[] = [];

  for (const row of claimed) {
    try {
      if (row.event_type === "inventory.sync") {
        const payload = parseInventorySyncPayload(row.payload);
        if (!payload) {
          await markOutboxFailed(db, row.id, "invalid inventory.sync payload");
          outcomes.push({
            id: row.id,
            event_type: row.event_type,
            status: "permanent",
            reason: "invalid payload",
          });
          continue;
        }

        const adapter = getMarketplaceAdapter(db, payload.channel_id);
        if (!adapter) {
          await markOutboxFailed(
            db,
            row.id,
            `no adapter bound for channel ${payload.channel_id}`,
          );
          outcomes.push({
            id: row.id,
            event_type: row.event_type,
            status: "permanent",
            reason: "no adapter",
          });
          continue;
        }

        await adapter.updateInventory({
          productId: payload.product_id,
          correctQty: payload.correct_qty,
        });
        await markOutboxDelivered(db, row.id);
        outcomes.push({
          id: row.id,
          event_type: row.event_type,
          status: "delivered",
        });
      } else {
        // Non-external events: nothing to dispatch, just mark delivered.
        // Order/lifecycle events (order.received, po.closed, etc.) are here
        // for downstream analytics and don't hit an external wire — same
        // no-op the old deliver_batch did.
        await markOutboxDelivered(db, row.id);
        outcomes.push({
          id: row.id,
          event_type: row.event_type,
          status: "delivered",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof AdapterRetryableError;
      const status = await markOutboxFailed(db, row.id, message);
      outcomes.push({
        id: row.id,
        event_type: row.event_type,
        status: status === "dead" ? "dead" : retryable ? "retryable" : "permanent",
        reason: message,
      });
    }
  }

  const delivered = outcomes.filter((o) => o.status === "delivered");
  const summary = {
    claimed: claimed.length,
    delivered: delivered.length,
    retryable: outcomes.filter((o) => o.status === "retryable").length,
    dead: outcomes.filter((o) => o.status === "dead").length,
    permanent: outcomes.filter((o) => o.status === "permanent").length,
    // Aliases kept for the pre-existing outbox integration test — new
    // callers should read `delivered` (count) and `outcomes` (per-row).
    delivered_count: delivered.length,
    event_types: delivered.map((d) => d.event_type),
  };

  return NextResponse.json(
    { ...summary, elapsed_ms: Date.now() - startedAt, outcomes },
    { status: 200 },
  );
}
