import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { skewChannelReport } from "@/lib/domain/reconciliation";

const bodySchema = z.object({
  channel_id: z.string().min(1),
  sku: z.string().min(1),
  delta: z.number().int(),
});

/**
 * POST /api/simulator/skew — chaos "Skew" button.
 *
 * Writes a channel_inventory_reports row that disagrees with our
 * available-to-sell by `delta` units. Next run_reconciliation() surfaces it
 * as a channel_drift finding. This is the demo's proof that when reality
 * and marketplace beliefs diverge, we can prove which one is wrong.
 */
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
  try {
    const outcome = await skewChannelReport(db, {
      channelId: parsed.data.channel_id,
      sku: parsed.data.sku,
      delta: parsed.data.delta,
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "skew failed" },
      { status: 500 },
    );
  }
}
