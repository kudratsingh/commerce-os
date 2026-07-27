import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { getDefaultLocationId } from "@/lib/domain/locations";
import { retryWebhookEvent } from "@/lib/domain/retry";

/**
 * POST /api/dlq/retry — re-processes a failed webhook event.
 *
 * Gated by `x-ops-secret` (see lib/auth/ops-secret.ts) until Module 3's
 * Supabase Auth sessions ship. Same-origin browser calls from the DLQ
 * panel must attach the header (proxied by a server action or a helper
 * that reads from an httpOnly cookie set at login).
 */

const bodySchema = z.object({
  event_id: z.string().uuid(),
});

export async function POST(req: Request): Promise<Response> {
  const auth = requireOpsSecret(req);
  if (!auth.ok) return auth.response;

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
