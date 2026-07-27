import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServer } from "@/lib/db/server";
import { getDefaultLocationId } from "@/lib/domain/locations";
import { retryWebhookEvent } from "@/lib/domain/retry";

/**
 * POST /api/dlq/retry — re-processes a failed webhook event.
 *
 * Called from the DLQ panel's per-row Retry button (same-origin, no CSRF
 * concern for this demo). The RPC refuses bad-signature events; other
 * failures land back in the DLQ with an updated last_error.
 *
 * Auth: none in this sprint. When the ops login lands (BUILD_PLAN scope
 * note), this route becomes session-gated.
 */

const bodySchema = z.object({
  event_id: z.string().uuid(),
});

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const db = createSupabaseServer();
  const locationId = await getDefaultLocationId(db);

  try {
    const outcome = await retryWebhookEvent(db, parsed.data.event_id, locationId);
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retry failed" },
      { status: 500 },
    );
  }
}
