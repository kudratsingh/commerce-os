import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import { planFilterSpec, runFilterSpec } from "@/lib/domain/nl-query";

const bodySchema = z.object({
  question: z.string().min(1).max(500),
});

/**
 * POST /api/nl-query — natural-language ops question → filter spec → results.
 *
 * ADR-007: the model NEVER emits SQL. It emits a JSON filter spec, we zod-
 * parse it (with one repair round-trip on failure), then run the spec
 * through our hand-written query builder. The UI displays the generated
 * spec alongside the results so the safety story is visible.
 *
 * Response shape:
 *   { spec, rows, attempts, raw_first?, raw_retry? }
 */
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

  const env = serverEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "NL query requires ANTHROPIC_API_KEY. Set it in .env.local (dev) or `wrangler secret put ANTHROPIC_API_KEY` (deployed).",
      },
      { status: 503 },
    );
  }

  try {
    const plan = await planFilterSpec(
      env.ANTHROPIC_API_KEY,
      parsed.data.question,
    );
    const db = createSupabaseServer();
    const rows = await runFilterSpec(db, plan.spec);
    return NextResponse.json(
      {
        spec: plan.spec,
        rows,
        attempts: plan.attempts,
        raw_first: plan.raw_first,
        raw_retry: plan.raw_retry,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "NL query failed" },
      { status: 502 },
    );
  }
}
