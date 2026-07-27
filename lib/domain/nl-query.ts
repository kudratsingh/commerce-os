import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { Db } from "@/lib/db/server";
import type { OrderRow } from "@/lib/queries/orders";

/**
 * NL query safety layer (ADR-007).
 *
 * Contract: the model NEVER emits SQL. It emits a filter spec matching
 * `filterSpecSchema` below. We zod-parse it, retry once with the validation
 * errors on failure, then map the spec to a typed supabase-js chain over an
 * allowlist of columns on `recent_orders`.
 *
 * Every field the query builder consults is enumerated here. Adding a new
 * capability is a schema PR — that's the point.
 */

const CHANNELS = ["tiktok_shop", "amazon", "walmart", "ebay", "target_plus"] as const;
const STATUSES = [
  "received",
  "allocated",
  "backordered",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;

export const filterSpecSchema = z
  .object({
    brand: z.string().min(1).max(64).optional(),
    channel: z.enum(CHANNELS).optional(),
    status: z.enum(STATUSES).optional(),
    placed_after: z.string().datetime({ offset: true }).optional(),
    placed_before: z.string().datetime({ offset: true }).optional(),
    min_subtotal_cents: z.number().int().nonnegative().optional(),
    max_subtotal_cents: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export type FilterSpec = z.infer<typeof filterSpecSchema>;

export interface NLQueryResult {
  spec: FilterSpec;
  rows: OrderRow[];
  attempts: number;
  raw_first?: string;
  raw_retry?: string;
}

const SYSTEM_PROMPT = `You are Commerce OS's operations assistant. Convert the user's question about orders into a JSON filter spec matching this schema:

{
  "brand"?: string (matches brand_name — one of "Voltcore Audio", "PeakBlend", "Lumo Home"),
  "channel"?: "tiktok_shop" | "amazon" | "walmart" | "ebay" | "target_plus",
  "status"?: "received" | "allocated" | "backordered" | "shipped" | "delivered" | "cancelled" | "refunded",
  "placed_after"?: ISO-8601 datetime with timezone,
  "placed_before"?: ISO-8601 datetime with timezone,
  "min_subtotal_cents"?: integer (money in cents — e.g. "over $100" => 10000),
  "max_subtotal_cents"?: integer,
  "limit"?: integer, max 200
}

RULES:
- Return ONLY the JSON object. No explanation, no markdown fences, no prose.
- Omit fields not implied by the question. Do NOT invent constraints.
- Money is always integer cents ($1 = 100).
- Interpret relative dates against the provided "now" in the user message.
- If the question can't be expressed with this schema, return {} (no filters).`;

/**
 * Model call → zod parse → one repair round-trip on failure. Returns the
 * validated spec + the raw text for auditability (the UI shows both).
 */
export async function planFilterSpec(
  apiKey: string,
  question: string,
  now: Date = new Date(),
  model = "claude-haiku-4-5-20251001",
): Promise<{ spec: FilterSpec; attempts: number; raw_first?: string; raw_retry?: string }> {
  const client = new Anthropic({ apiKey });
  const userMsg = `now = ${now.toISOString()}\nquestion: ${question}`;

  const first = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const firstText = extractText(first);
  const firstParse = tryParseSpec(firstText);
  if (firstParse.ok) {
    return { spec: firstParse.spec, attempts: 1, raw_first: firstText };
  }

  const retryMsg = `Your previous reply did not match the schema:

${firstText}

Errors:
${firstParse.errors}

Return ONLY a valid JSON object matching the schema. No prose.`;
  const retry = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userMsg },
      { role: "assistant", content: firstText },
      { role: "user", content: retryMsg },
    ],
  });
  const retryText = extractText(retry);
  const retryParse = tryParseSpec(retryText);
  if (retryParse.ok) {
    return {
      spec: retryParse.spec,
      attempts: 2,
      raw_first: firstText,
      raw_retry: retryText,
    };
  }

  throw new Error(
    `NL query planner failed after 2 attempts. Last errors: ${retryParse.errors}`,
  );
}

function extractText(
  msg: Anthropic.Messages.Message,
): string {
  for (const block of msg.content) {
    if (block.type === "text") return block.text.trim();
  }
  return "";
}

function tryParseSpec(
  text: string,
): { ok: true; spec: FilterSpec } | { ok: false; errors: string } {
  const stripped = stripFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, errors: `not valid JSON: ${(err as Error).message}` };
  }
  const result = filterSpecSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, spec: result.data };
}

function stripFences(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences if the model emitted them.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text.trim());
  return fenced ? fenced[1] : text;
}

/**
 * Query builder — maps spec fields to a typed supabase-js chain over the
 * `recent_orders` view. Every branch here is a field the model can influence;
 * this is the allowlist. New capability = new branch + new schema field.
 */
export async function runFilterSpec(
  db: Db,
  spec: FilterSpec,
): Promise<OrderRow[]> {
  let q = db
    .from("recent_orders")
    .select(
      "id, channel_id, external_order_id, status, buyer_handle, subtotal_cents, placed_at, created_at, brand_id, brand_name",
    );

  if (spec.brand) q = q.ilike("brand_name", `%${spec.brand}%`);
  if (spec.channel) q = q.eq("channel_id", spec.channel);
  if (spec.status) q = q.eq("status", spec.status);
  if (spec.placed_after) q = q.gte("placed_at", spec.placed_after);
  if (spec.placed_before) q = q.lte("placed_at", spec.placed_before);
  if (spec.min_subtotal_cents !== undefined)
    q = q.gte("subtotal_cents", spec.min_subtotal_cents);
  if (spec.max_subtotal_cents !== undefined)
    q = q.lte("subtotal_cents", spec.max_subtotal_cents);

  q = q.order("placed_at", { ascending: false }).limit(spec.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(`NL query execution failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    channel_id: r.channel_id ?? "",
    external_order_id: r.external_order_id ?? "",
    status: (r.status ?? "received") as OrderRow["status"],
    buyer_handle: r.buyer_handle ?? null,
    subtotal_cents: r.subtotal_cents ?? 0,
    placed_at: r.placed_at ?? new Date(0).toISOString(),
    created_at: r.created_at ?? new Date(0).toISOString(),
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? "",
  }));
}
