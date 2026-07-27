import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import {
  registerTouchpoint,
  touchpointDirectionSchema,
  touchpointKindSchema,
} from "@/lib/domain/creators";

/**
 * POST /api/creators/[id]/touchpoints — log an interaction and let the
 * register_touchpoint() RPC derive any resulting status transition
 * (ADR-012). This is the CRM's ONLY writer to creators.status.
 */

const bodySchema = z
  .object({
    kind: touchpointKindSchema,
    direction: touchpointDirectionSchema,
    medium: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
    actor: z.string().max(80).optional(),
    occurred_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = requireOpsSecret(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid creator id" }, { status: 400 });
  }

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
    const outcome = await registerTouchpoint(db, {
      creatorId: id,
      kind: parsed.data.kind,
      direction: parsed.data.direction,
      medium: parsed.data.medium,
      notes: parsed.data.notes,
      actor: parsed.data.actor,
      occurredAt: parsed.data.occurred_at,
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "register_touchpoint failed" },
      { status: 500 },
    );
  }
}
