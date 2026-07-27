import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import { verifySignature } from "@/lib/domain/hmac";
import { getDefaultLocationId } from "@/lib/domain/locations";
import { processOrderEvent } from "@/lib/domain/process-event";
import { webhookPayloadSchema } from "@/lib/domain/webhook-schema";

/**
 * POST /api/webhooks/tiktok — the hardened front door.
 *
 * Pipeline (each step idempotent, mostly executed inside a single Postgres
 * function call — see migration 003 for the DB-side atomicity):
 *
 *   1. Read raw body first (before any parsing) so HMAC verifies the exact
 *      bytes the sender signed.
 *   2. Verify HMAC. Invalid → record event with signature_valid=false
 *      (status becomes 'dead' inside process_order_event), 401 out.
 *   3. Parse JSON, zod.safeParse the payload. Malformed → still record for
 *      DLQ visibility with a synthesized event_id, 400 out.
 *   4. Call process_order_event RPC. It handles dedupe (ADR-004), order
 *      upsert, allocate_order, outbox write, and event bookkeeping in one
 *      transaction (ADR-001..003).
 *   5. Map outcome to HTTP: dedupe = 200 {deduped:true} (never 4xx —
 *      marketplaces retry non-2xx forever, see ADR-004); allocated /
 *      backordered / cancelled = 200 with status; failed = 200 with error
 *      body (row is in DLQ for humans, marketplace stops retrying).
 */

const CHANNEL_ID = "tiktok_shop";
const MAX_BODY_BYTES = 128 * 1024;

export async function POST(req: Request): Promise<Response> {
  const raw = await readBoundedText(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const env = serverEnv();
  const signatureHeader = req.headers.get("x-signature") ?? "";
  const signatureValid = await verifySignature(
    env.WEBHOOK_SHARED_SECRET,
    raw,
    signatureHeader,
  );

  const db = createSupabaseServer();
  const locationId = await getDefaultLocationId(db);

  // JSON parse ---------------------------------------------------------------
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // truly broken bytes — still record for DLQ visibility (chaos "malformed"
    // button lands here) so the operator sees it. Synth event_id since we
    // can't dedupe what we can't read.
    const synth = `malformed_${crypto.randomUUID()}`;
    await processOrderEvent(db, {
      channelId: CHANNEL_ID,
      externalEventId: synth,
      eventType: "unknown",
      payload: { _raw: raw.slice(0, 4096) },
      signatureValid,
      locationId,
    });
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  // Zod validate --------------------------------------------------------------
  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const fallbackId =
      typeof json === "object" && json && "event_id" in json &&
      typeof (json as { event_id: unknown }).event_id === "string"
        ? (json as { event_id: string }).event_id
        : `malformed_${crypto.randomUUID()}`;
    await processOrderEvent(db, {
      channelId: CHANNEL_ID,
      externalEventId: fallbackId,
      eventType: "unknown",
      payload: json as never,
      signatureValid,
      locationId,
    });
    return NextResponse.json(
      {
        error: "schema validation failed",
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const payload = parsed.data;

  // Domain call --------------------------------------------------------------
  const outcome = await processOrderEvent(db, {
    channelId: CHANNEL_ID,
    externalEventId: payload.event_id,
    eventType: payload.event_type,
    payload,
    signatureValid,
    locationId,
  });

  switch (outcome.outcome) {
    case "deduped":
      // 200 on purpose (ADR-004): stops the marketplace retrying.
      return NextResponse.json({ deduped: true }, { status: 200 });

    case "bad_signature":
      // 401 is the one non-2xx we allow — attacks/misconfig should not be
      // silently acked.
      return NextResponse.json(
        { error: "invalid HMAC signature" },
        { status: 401 },
      );

    case "allocated":
    case "backordered":
    case "cancelled":
    case "shipped":
    case "returned":
    case "delivered":
      return NextResponse.json(
        {
          status: outcome.outcome,
          order_id: outcome.order_id,
          event_id: outcome.event_id,
        },
        { status: 200 },
      );

    case "failed":
      // 200 (not 5xx): the event row is in the DLQ; humans fix + retry.
      // A 5xx would put us in an infinite marketplace-retry loop.
      return NextResponse.json(
        {
          error: outcome.reason ?? "processing failed",
          event_id: outcome.event_id,
        },
        { status: 200 },
      );
  }
}

async function readBoundedText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  return text;
}
