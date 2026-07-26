import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import { deliverOutboxBatch } from "@/lib/domain/outbox";

/**
 * POST /api/jobs/outbox-sweep — re-entrant outbox sweeper.
 *
 * Called two ways:
 *   1. Cloudflare Cron Trigger (1/min) — wired via a custom worker
 *      entrypoint (deferred to Day 4 with the Run Now UI; see PR notes).
 *   2. Manual "Run Now" button on the ops dashboard (Day 4).
 *
 * Safe under overlapping firings: `outbox_deliver_batch` claims rows with
 * FOR UPDATE SKIP LOCKED and marks them delivered atomically. Delivery is a
 * no-op for the demo — the returned rows are the demonstration that we
 * would fanout here (analytics, Slack, marketplace ack) in production.
 *
 * Guarded by a shared secret so a stray outside call can't drain the queue
 * (matches the pattern the real cron will use).
 */

const BATCH_LIMIT = 100;

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const providedSecret = req.headers.get("x-cron-secret");
  if (providedSecret !== env.WEBHOOK_SHARED_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createSupabaseServer();
  const startedAt = Date.now();
  const delivered = await deliverOutboxBatch(db, BATCH_LIMIT);

  return NextResponse.json(
    {
      delivered_count: delivered.length,
      elapsed_ms: Date.now() - startedAt,
      // Return the event_types (not full payloads) so an operator running
      // this manually can see what just went out without leaking large blobs.
      event_types: delivered.map((d) => d.event_type),
    },
    { status: 200 },
  );
}
