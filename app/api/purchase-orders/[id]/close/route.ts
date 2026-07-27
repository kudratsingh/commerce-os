import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { closePurchaseOrder } from "@/lib/domain/purchasing";

/**
 * POST /api/purchase-orders/[id]/close — administratively close a PO.
 * Idempotent (second call returns `already_closed`).
 */

const bodySchema = z
  .object({ reason: z.string().max(200).optional() })
  .strict()
  .optional();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = requireOpsSecret(req);
  if (!auth.ok) return auth.response;

  const { id: poId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(poId)) {
    return NextResponse.json({ error: "invalid po id" }, { status: 400 });
  }

  let json: unknown = undefined;
  try {
    json = await req.json();
  } catch {
    // empty body is fine — reason is optional
  }
  const parsed = bodySchema.safeParse(json ?? {});
  const reason = parsed.success ? parsed.data?.reason : undefined;

  const db = createSupabaseServer();
  try {
    const outcome = await closePurchaseOrder(db, poId, reason);
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "close failed" },
      { status: 500 },
    );
  }
}
