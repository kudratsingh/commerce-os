import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import { erpWebhookPayloadSchema } from "@/lib/domain/erp-schema";
import { verifySignature } from "@/lib/domain/hmac";

/**
 * POST /api/webhooks/erp — the ESI/ERP inbound channel (ADR-011).
 *
 * Same pipeline as /api/webhooks/tiktok: HMAC, dedupe, zod validate, DLQ.
 * Different domain function on the far side: `process_erp_event` writes
 * ledger movements for cycle counts / transfers / damage instead of
 * allocating orders.
 *
 * The middle-tier compression: this route consumes ESI's mastership of
 * `on_hand`. The outbox + adapter push our `available` OUT to marketplaces.
 * We own `committed` in between.
 */

const CHANNEL_ID = "erp_esi";
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

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    const synth = `malformed_${crypto.randomUUID()}`;
    await db.rpc("process_erp_event", {
      p_channel_id: CHANNEL_ID,
      p_external_event_id: synth,
      p_event_type: "unknown",
      p_payload: { _raw: raw.slice(0, 4096) },
      p_signature_valid: signatureValid,
    });
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = erpWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const fallbackId =
      typeof json === "object" && json && "event_id" in json &&
      typeof (json as { event_id: unknown }).event_id === "string"
        ? (json as { event_id: string }).event_id
        : `malformed_${crypto.randomUUID()}`;
    await db.rpc("process_erp_event", {
      p_channel_id: CHANNEL_ID,
      p_external_event_id: fallbackId,
      p_event_type: "unknown",
      p_payload: json as never,
      p_signature_valid: signatureValid,
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

  const { data: rpcData, error: rpcError } = await db.rpc("process_erp_event", {
    p_channel_id: CHANNEL_ID,
    p_external_event_id: payload.event_id,
    p_event_type: payload.event_type,
    p_payload: payload as unknown as never,
    p_signature_valid: signatureValid,
  });
  if (rpcError) {
    return NextResponse.json(
      { error: `process_erp_event failed: ${rpcError.message}` },
      { status: 500 },
    );
  }

  const outcome = rpcData as { outcome?: string; reason?: string; error?: string };
  switch (outcome?.outcome) {
    case "deduped":
      return NextResponse.json({ deduped: true }, { status: 200 });
    case "dead":
      return NextResponse.json(
        { error: outcome.reason ?? "invalid HMAC signature" },
        { status: 401 },
      );
    case "processed":
      return NextResponse.json(
        { status: "processed", event_id: payload.event_id },
        { status: 200 },
      );
    case "failed":
      // Same convention as the tiktok route — non-2xx would put us in a
      // marketplace retry loop; instead we DLQ and let humans fix.
      return NextResponse.json(
        { error: outcome.error ?? "processing failed", event_id: payload.event_id },
        { status: 200 },
      );
    default:
      return NextResponse.json(
        { error: "unknown outcome", raw: outcome },
        { status: 500 },
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
