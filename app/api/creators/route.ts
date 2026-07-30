import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";

/**
 * POST /api/creators — create a creator row in status='prospect'.
 *
 * Status transitions after this happen via register_touchpoint (ADR-012):
 * the CRM ledger derives status from the touchpoint stream. The initial
 * insert just names the row.
 */

const platformSchema = z.enum([
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "other",
]);

const bodySchema = z
  .object({
    handle: z
      .string()
      .min(1)
      .max(80)
      .regex(/^@?[\w.\-]+$/, "handle must be a valid username"),
    platform: platformSchema,
    display_name: z.string().max(120).optional(),
    contact_email: z.string().email().optional(),
    contact_phone: z.string().max(30).optional(),
    base_country: z
      .string()
      .length(2, "ISO 3166-1 alpha-2 (e.g. US)")
      .optional(),
    primary_categories: z.array(z.string().min(1)).max(10).optional(),
    follower_count: z.number().int().nonnegative().optional(),
    engagement_rate: z.number().min(0).max(1).optional(),
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
  const handle = parsed.data.handle.startsWith("@")
    ? parsed.data.handle
    : `@${parsed.data.handle}`;

  const { data, error } = await db
    .from("creators")
    .insert({
      handle,
      platform: parsed.data.platform,
      display_name: parsed.data.display_name ?? null,
      contact_email: parsed.data.contact_email ?? null,
      contact_phone: parsed.data.contact_phone ?? null,
      base_country: parsed.data.base_country ?? null,
      primary_categories: parsed.data.primary_categories ?? [],
      follower_count: parsed.data.follower_count ?? null,
      engagement_rate: parsed.data.engagement_rate ?? null,
    })
    .select("id, handle, platform, status")
    .single();

  if (error) {
    // Unique-violation on handle — friendlier surface than "duplicate key"
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json(
        { error: `creator ${handle} already exists` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `creator insert failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ creator: data }, { status: 201 });
}
