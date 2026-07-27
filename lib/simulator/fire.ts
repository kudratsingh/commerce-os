import type { WebhookPayload } from "@/lib/domain/webhook-schema";

import { signBody } from "@/lib/domain/hmac";

/**
 * Sign a payload + invoke the webhook route.
 *
 * Two invocation modes, chosen at call time by whether `opts.webhookHandler`
 * is provided:
 *
 *   • **Direct** (default when handler passed) — call the route handler
 *     function directly with a synthetic Request. Same code path as an HTTP
 *     POST, but no network hop. This is what the in-app simulator uses in
 *     the deployed worker so requests don't round-trip through Cloudflare
 *     Access (which would intercept unauthenticated internal fetches to
 *     `/api/webhooks/tiktok`).
 *
 *   • **HTTP** (when only `url` passed) — real fetch to `opts.url`. What the
 *     CLI script uses (`scripts/fire-webhook.ts`) since it's fired against a
 *     running dev server. Also how a real marketplace would hit the endpoint.
 *
 * Both paths sign the body with the same HMAC helper the verifier uses, so
 * the signature branch of the ingestion is exercised either way.
 */

export interface FireOptions {
  /** URL to POST to. Required for HTTP mode. */
  url?: string;
  /** Route handler to invoke directly. If set, no HTTP fetch happens. */
  webhookHandler?: (req: Request) => Promise<Response>;
  /** HMAC secret. */
  secret: string;
  /** Sign with a bogus secret so the verifier rejects (chaos). */
  useBadSecret?: boolean;
  /**
   * Well-formed hex signature that just doesn't match the body — exercises
   * the "signature present but wrong" branch, distinct from `useBadSecret`.
   */
  overrideSignatureHeader?: string;
}

export interface FireResult {
  status: number;
  body: unknown;
}

const WRONG_SECRET = "wrong-secret-does-not-verify";

async function invokeWebhook(body: string, opts: FireOptions): Promise<FireResult> {
  const secretToUse = opts.useBadSecret ? WRONG_SECRET : opts.secret;
  const signature =
    opts.overrideSignatureHeader ?? (await signBody(secretToUse, body));

  const headers = {
    "content-type": "application/json",
    "x-signature": signature,
  };

  let response: Response;

  if (opts.webhookHandler) {
    // Direct call — no network. URL is synthetic; the handler only reads
    // it to derive its own base URL for downstream operations, which we
    // don't use here.
    const req = new Request("http://internal/api/webhooks/tiktok", {
      method: "POST",
      headers,
      body,
    });
    response = await opts.webhookHandler(req);
  } else {
    if (!opts.url) {
      throw new Error("firePayload requires either `url` or `webhookHandler`");
    }
    response = await fetch(opts.url, { method: "POST", headers, body });
  }

  // Read body ONCE via .text(), then attempt JSON parse. This avoids the
  // "Body has already been used" trap of `res.json() catch res.text()`.
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

export async function firePayload(
  payload: WebhookPayload | unknown,
  opts: FireOptions,
): Promise<FireResult> {
  return invokeWebhook(JSON.stringify(payload), opts);
}

/**
 * Fire a raw string body — for the "invalid JSON" chaos scenario where we
 * want to bypass JSON.stringify entirely.
 */
export async function fireRaw(body: string, opts: FireOptions): Promise<FireResult> {
  return invokeWebhook(body, opts);
}
