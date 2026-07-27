"use server";

import { POST as retryDlqRoute } from "@/app/api/dlq/retry/route";
import { POST as nlQueryRoute } from "@/app/api/nl-query/route";
import { POST as resolveFindingRoute } from "@/app/api/reconciliation/resolve/route";
import { POST as runReconciliationRoute } from "@/app/api/reconciliation/run/route";
import { POST as fireScenarioRoute } from "@/app/api/simulator/fire/route";
import { POST as skewChannelRoute } from "@/app/api/simulator/skew/route";
import { serverEnv } from "@/lib/domain/env";

/**
 * Server actions that proxy the ops-only routes. The secret is injected
 * server-side (never in the browser bundle — invariant #8).
 *
 * We call the route handler functions DIRECTLY with a synthetic Request
 * — no HTTP hop to `self`. This matters on Cloudflare because a
 * `fetch("https://this-worker/...")` from inside the worker goes back
 * through the edge, where Cloudflare Access intercepts unauthenticated
 * requests with a 302 to the login page. Server-side JSON.parse of that
 * HTML redirect would blow up. Direct function call sidesteps both the
 * network cost and the Access loop.
 *
 * The route handler still performs its zod validation + `requireOpsSecret`
 * check, so behavior is identical to an external POST.
 */

interface RouteResult<T> {
  status: number;
  body: T;
}

async function callRoute<T>(
  handler: (req: Request) => Promise<Response>,
  path: string,
  body?: unknown,
): Promise<RouteResult<T>> {
  const env = serverEnv();
  const url = `http://internal${path}`;
  const req = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ops-secret": env.OPS_SHARED_SECRET,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req);
  let parsed: T;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = (await res.text()) as unknown as T;
  }
  return { status: res.status, body: parsed };
}

// ----------------------------------------------------------------------------
// Simulator
// ----------------------------------------------------------------------------

export interface FireResponse {
  scenario: string;
  fired: number;
  results: Array<{ status: number; body: { status?: string; deduped?: boolean; error?: string } }>;
  elapsed_ms: number;
  error?: string;
}

export async function fireScenarioAction(
  scenario: string,
  count?: number,
): Promise<RouteResult<FireResponse>> {
  return callRoute<FireResponse>(fireScenarioRoute, "/api/simulator/fire", { scenario, count });
}

export interface SkewResponse {
  outcome?: string;
  available?: number;
  reported?: number;
  error?: string;
}

export async function skewChannelAction(
  channel_id: string,
  sku: string,
  delta: number,
): Promise<RouteResult<SkewResponse>> {
  return callRoute<SkewResponse>(skewChannelRoute, "/api/simulator/skew", {
    channel_id,
    sku,
    delta,
  });
}

// ----------------------------------------------------------------------------
// Reconciliation
// ----------------------------------------------------------------------------

export interface RunReconResponse {
  run_id?: string;
  error?: string;
}

export async function runReconciliationAction(): Promise<RouteResult<RunReconResponse>> {
  return callRoute<RunReconResponse>(runReconciliationRoute, "/api/reconciliation/run");
}

export interface ResolveFindingResponse {
  outcome?: string;
  finding_id?: number;
  error?: string;
}

export async function resolveFindingAction(
  finding_id: number,
): Promise<RouteResult<ResolveFindingResponse>> {
  return callRoute<ResolveFindingResponse>(resolveFindingRoute, "/api/reconciliation/resolve", {
    finding_id,
  });
}

// ----------------------------------------------------------------------------
// DLQ retry
// ----------------------------------------------------------------------------

export interface RetryResponse {
  outcome?: string;
  event_id?: string;
  order_id?: string;
  reason?: string;
  error?: string;
}

export async function retryDlqAction(
  event_id: string,
): Promise<RouteResult<RetryResponse>> {
  return callRoute<RetryResponse>(retryDlqRoute, "/api/dlq/retry", { event_id });
}

// ----------------------------------------------------------------------------
// NL query
// ----------------------------------------------------------------------------

export interface NlQueryResponse {
  spec?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  attempts?: number;
  raw_first?: string;
  raw_retry?: string;
  error?: string;
}

export async function askNlQueryAction(
  question: string,
): Promise<RouteResult<NlQueryResponse>> {
  return callRoute<NlQueryResponse>(nlQueryRoute, "/api/nl-query", { question });
}
