import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { resolveFinding } from "@/lib/domain/reconciliation";

const bodySchema = z.object({
  finding_id: z.number().int().positive(),
});

/**
 * POST /api/reconciliation/resolve — marks a finding resolved so it drops
 * out of `open_findings`. Auditable — the row itself is preserved.
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
    const outcome = await resolveFinding(db, parsed.data.finding_id);
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "resolve failed" },
      { status: 500 },
    );
  }
}
