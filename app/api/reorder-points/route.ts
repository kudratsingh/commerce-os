import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { upsertReorderPoint } from "@/lib/domain/purchasing";
import { getDefaultLocationId } from "@/lib/domain/locations";

/**
 * POST /api/reorder-points — upsert per-product-per-location threshold.
 * Called by the /replenishment or /settings/reorder UI.
 */

const bodySchema = z
  .object({
    product_id: z.string().uuid(),
    location_id: z.string().uuid().optional(),
    min_qty: z.number().int().nonnegative(),
    target_qty: z.number().int().nonnegative(),
    velocity_window_days: z.number().int().positive().max(365).optional(),
  })
  .strict()
  .refine((v) => v.target_qty >= v.min_qty, {
    message: "target_qty must be >= min_qty",
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
  const locationId = parsed.data.location_id ?? (await getDefaultLocationId(db));

  try {
    const outcome = await upsertReorderPoint(db, {
      productId: parsed.data.product_id,
      locationId,
      minQty: parsed.data.min_qty,
      targetQty: parsed.data.target_qty,
      velocityWindow: parsed.data.velocity_window_days
        ? `${parsed.data.velocity_window_days} days`
        : undefined,
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upsert failed" },
      { status: 500 },
    );
  }
}
