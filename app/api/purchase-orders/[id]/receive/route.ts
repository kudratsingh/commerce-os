import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { receiveShipment } from "@/lib/domain/purchasing";
import { getDefaultLocationId } from "@/lib/domain/locations";

/**
 * POST /api/purchase-orders/[id]/receive — record a shipment against a
 * specific PO line. The receipt writes stock_movements (+qty), bumps
 * stock_levels.on_hand, captures a landed_costs snapshot, and transitions
 * the parent PO status. All atomic.
 */

const bodySchema = z
  .object({
    po_line_id: z.string().uuid(),
    qty: z.number().int().positive(),
    unit_cost_cents: z.number().int().nonnegative(),
    duties_cents: z.number().int().nonnegative().optional(),
    freight_cents: z.number().int().nonnegative().optional(),
    handling_cents: z.number().int().nonnegative().optional(),
    location_id: z.string().uuid().optional(), // defaults to Van Nuys DC
  })
  .strict();

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
  const locationId = parsed.data.location_id ?? (await getDefaultLocationId(db));

  try {
    const receiptId = await receiveShipment(db, {
      poLineId: parsed.data.po_line_id,
      locationId,
      qty: parsed.data.qty,
      unitCostCents: parsed.data.unit_cost_cents,
      dutiesCents: parsed.data.duties_cents,
      freightCents: parsed.data.freight_cents,
      handlingCents: parsed.data.handling_cents,
    });
    return NextResponse.json(
      { receipt_id: receiptId, po_id: poId },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "receive failed" },
      { status: 500 },
    );
  }
}
