import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { createPurchaseOrder, poLineSchema } from "@/lib/domain/purchasing";

/**
 * POST /api/purchase-orders — create a PO with lines in one transaction.
 * The /purchasing/new form's server action targets this.
 */

const bodySchema = z
  .object({
    brand_id: z.string().uuid(),
    supplier_id: z.string().uuid(),
    expected_at: z.string().datetime({ offset: true }).nullable().optional(),
    lines: z.array(poLineSchema).min(1),
  })
  .strict();

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
    const poId = await createPurchaseOrder(db, {
      brandId: parsed.data.brand_id,
      supplierId: parsed.data.supplier_id,
      expectedAt: parsed.data.expected_at ?? null,
      lines: parsed.data.lines,
    });
    return NextResponse.json({ po_id: poId }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}
