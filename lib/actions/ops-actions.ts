"use server";

import { POST as retryDlqRoute } from "@/app/api/dlq/retry/route";
import { POST as sweepOutboxRoute } from "@/app/api/jobs/outbox-sweep/route";
import { POST as nlQueryRoute } from "@/app/api/nl-query/route";
import { POST as closePORoute } from "@/app/api/purchase-orders/[id]/close/route";
import { POST as receivePORoute } from "@/app/api/purchase-orders/[id]/receive/route";
import { POST as createPORoute } from "@/app/api/purchase-orders/route";
import { POST as resolveFindingRoute } from "@/app/api/reconciliation/resolve/route";
import { POST as runReconciliationRoute } from "@/app/api/reconciliation/run/route";
import { POST as upsertReorderPointRoute } from "@/app/api/reorder-points/route";
import { POST as fireScenarioRoute } from "@/app/api/simulator/fire/route";
import { POST as hostileRateRoute } from "@/app/api/simulator/hostile/route";
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

/**
 * Wrapper for routes that need URL params (path-based, e.g. /po/[id]/…).
 * Handler expects `ctx.params` — we pass a Promise for parity with Next 15.
 */
async function callRouteWithParams<T>(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  path: string,
  id: string,
  body?: unknown,
): Promise<RouteResult<T>> {
  const env = serverEnv();
  const req = new Request(`http://internal${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ops-secret": env.OPS_SHARED_SECRET,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve({ id }) });
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

export interface HostileResponse {
  hostile_rate?: number;
  error?: string;
}

export async function setHostileRateAction(
  hostile_rate: number,
): Promise<RouteResult<HostileResponse>> {
  return callRoute<HostileResponse>(hostileRateRoute, "/api/simulator/hostile", {
    hostile_rate,
  });
}

/**
 * Manually drain the outbox from the UI. Uses the CRON secret (not the
 * ops secret) because the sweep endpoint's contract is "the cron worker
 * calls me"; from the ops UI we're doing what the cron would do.
 */
export interface SweepResponse {
  claimed?: number;
  delivered?: number;
  retryable?: number;
  dead?: number;
  permanent?: number;
  elapsed_ms?: number;
  error?: string;
}

export async function sweepOutboxAction(): Promise<RouteResult<SweepResponse>> {
  const env = serverEnv();
  const req = new Request("http://internal/api/jobs/outbox-sweep", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": env.WEBHOOK_SHARED_SECRET,
    },
  });
  const res = await sweepOutboxRoute(req);
  let body: SweepResponse;
  try {
    body = (await res.json()) as SweepResponse;
  } catch {
    body = { error: await res.text() };
  }
  return { status: res.status, body };
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
  strategy?: "ack" | "accept_source";
  error?: string;
}

export async function resolveFindingAction(
  finding_id: number,
  strategy: "ack" | "accept_source" = "ack",
  note?: string,
): Promise<RouteResult<ResolveFindingResponse>> {
  return callRoute<ResolveFindingResponse>(resolveFindingRoute, "/api/reconciliation/resolve", {
    finding_id,
    strategy,
    note,
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

// ----------------------------------------------------------------------------
// Purchasing (Module 1 M1-B/C/D)
// ----------------------------------------------------------------------------

export interface CreatePOInput {
  brand_id: string;
  supplier_id: string;
  expected_at?: string | null;
  lines: Array<{ product_id: string; qty_ordered: number; unit_cost_cents: number }>;
}

export interface CreatePOResponse {
  po_id?: string;
  error?: string;
}

export async function createPurchaseOrderAction(
  input: CreatePOInput,
): Promise<RouteResult<CreatePOResponse>> {
  return callRoute<CreatePOResponse>(createPORoute, "/api/purchase-orders", input);
}

export interface ReceiveShipmentInput {
  po_line_id: string;
  qty: number;
  unit_cost_cents: number;
  duties_cents?: number;
  freight_cents?: number;
  handling_cents?: number;
}

export interface ReceiveShipmentResponse {
  receipt_id?: string;
  po_id?: string;
  error?: string;
}

export async function receiveShipmentAction(
  poId: string,
  input: ReceiveShipmentInput,
): Promise<RouteResult<ReceiveShipmentResponse>> {
  return callRouteWithParams<ReceiveShipmentResponse>(
    receivePORoute,
    `/api/purchase-orders/${poId}/receive`,
    poId,
    input,
  );
}

export interface CloseOrderResponse {
  outcome?: "closed" | "already_closed";
  previous_status?: string;
  error?: string;
}

export async function closePurchaseOrderAction(
  poId: string,
  reason?: string,
): Promise<RouteResult<CloseOrderResponse>> {
  return callRouteWithParams<CloseOrderResponse>(
    closePORoute,
    `/api/purchase-orders/${poId}/close`,
    poId,
    reason ? { reason } : undefined,
  );
}

export interface UpsertReorderPointInput {
  product_id: string;
  min_qty: number;
  target_qty: number;
  location_id?: string;
  velocity_window_days?: number;
}

export interface UpsertReorderPointResponse {
  outcome?: "saved";
  error?: string;
}

export async function upsertReorderPointAction(
  input: UpsertReorderPointInput,
): Promise<RouteResult<UpsertReorderPointResponse>> {
  return callRoute<UpsertReorderPointResponse>(
    upsertReorderPointRoute,
    "/api/reorder-points",
    input,
  );
}
