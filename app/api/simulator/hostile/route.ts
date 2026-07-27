import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";

const bodySchema = z.object({
  hostile_rate: z.number().min(0).max(1),
});

/**
 * POST /api/simulator/hostile — chaos "Hostile mode" slider.
 *
 * Writes `simulator_config.hostile_rate` (0..1). SimulatedTikTokAdapter
 * rolls against this value on every updateInventory call and throws a
 * retryable 429-shape error when it loses. The outbox sweeper's
 * exponential backoff is thus demonstrable live: set 0.3 → fire a burst →
 * watch a subset of rows retry → set back to 0 → next sweep drains the DLQ.
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
  const { error } = await db.rpc("set_simulator_config", {
    p_key: "hostile_rate",
    p_value: parsed.data.hostile_rate,
  });
  if (error) {
    return NextResponse.json(
      { error: `set_simulator_config failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ hostile_rate: parsed.data.hostile_rate }, { status: 200 });
}
