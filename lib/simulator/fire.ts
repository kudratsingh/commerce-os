import { signBody } from "@/lib/domain/hmac";

/**
 * Sign + POST a payload at the webhook endpoint.
 *
 * Uses the exact same HMAC helper the verifier uses, so the demo exercises
 * the real signature path — a "bad signature" chaos scenario is achieved by
 * signing with the wrong secret or garbling the header, not by mocking the
 * check out.
 */

export interface FireOptions {
  /** Full URL to the webhook endpoint. */
  url: string;
  /** Shared secret the verifier expects (WEBHOOK_SHARED_SECRET). */
  secret: string;
  /** Sign with a bogus secret so the verifier rejects (chaos). */
  useBadSecret?: boolean;
  /**
   * Send a well-formed hex signature that just doesn't match the body.
   * Distinct from `useBadSecret`: this exercises the "signature present but
   * wrong" branch, not the "no signature at all" branch.
   */
  overrideSignatureHeader?: string;
}

export interface FireResult {
  status: number;
  body: unknown;
}

const WRONG_SECRET = "wrong-secret-does-not-verify";

export async function firePayload(
  payload: unknown,
  opts: FireOptions,
): Promise<FireResult> {
  const body = JSON.stringify(payload);
  const secretToUse = opts.useBadSecret ? WRONG_SECRET : opts.secret;
  const signature =
    opts.overrideSignatureHeader ?? (await signBody(secretToUse, body));

  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }

  return { status: res.status, body: parsed };
}

/**
 * Fire a raw string body (already JSON or intentionally malformed). Used
 * when we want to bypass JSON.stringify to test invalid JSON handling.
 */
export async function fireRaw(
  body: string,
  opts: FireOptions,
): Promise<FireResult> {
  const secretToUse = opts.useBadSecret ? WRONG_SECRET : opts.secret;
  const signature =
    opts.overrideSignatureHeader ?? (await signBody(secretToUse, body));

  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }

  return { status: res.status, body: parsed };
}
