import "server-only";

import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/domain/env";

/**
 * Shared-secret gate for ops-only mutating routes.
 *
 * Currently protects: simulator, reconciliation, DLQ retry, NL query. The
 * outbox-sweep route uses the same pattern (with WEBHOOK_SHARED_SECRET as
 * its cron secret) — this helper generalizes it.
 *
 * When Module 3's Supabase Auth session gating lands, these routes flip
 * from "shared secret" to "session-scoped role check." Until then, this
 * plus Cloudflare Access on the whole worker is what keeps a stranger from
 * draining the DLQ / burning our Anthropic key.
 *
 * Constant-time compare via a length-checked XOR walk — never use `===` on
 * secrets.
 */

const HEADER = "x-ops-secret";

const encoder = new TextEncoder();

export interface OpsAuthOk { ok: true }
export interface OpsAuthFail { ok: false; response: Response }
export type OpsAuthResult = OpsAuthOk | OpsAuthFail;

export function requireOpsSecret(req: Request): OpsAuthResult {
  const env = serverEnv();
  const provided = req.headers.get(HEADER) ?? "";
  const expected = env.OPS_SHARED_SECRET;

  if (!constantTimeEqual(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `missing or invalid ${HEADER} header` },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

/**
 * Constant-time string comparison. Returns false on any length mismatch
 * (fine — same-length equality is what we care about) and does not
 * short-circuit on the first byte diff.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
