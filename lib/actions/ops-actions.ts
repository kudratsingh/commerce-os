"use server";

import { headers } from "next/headers";

import { serverEnv } from "@/lib/domain/env";

/**
 * Server actions that proxy the ops-only routes with the shared secret
 * attached server-side. Client components call these — the secret never
 * crosses into the browser bundle.
 *
 * Each action mirrors the shape of the route it proxies (same request body,
 * same response body) so callers can be swapped between action and direct
 * fetch without behavior change.
 */

async function callOpsRoute<T>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const env = serverEnv();
  const h = await headers();
  const host = h.get("host") ?? "127.0.0.1:3001";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("workers.dev") ? "https" : "http");
  const url = `${proto}://${host}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ops-secret": env.OPS_SHARED_SECRET,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
): Promise<{ status: number; body: FireResponse }> {
  return callOpsRoute<FireResponse>("/api/simulator/fire", { scenario, count });
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
): Promise<{ status: number; body: SkewResponse }> {
  return callOpsRoute<SkewResponse>("/api/simulator/skew", { channel_id, sku, delta });
}

// ----------------------------------------------------------------------------
// Reconciliation
// ----------------------------------------------------------------------------

export interface RunReconResponse {
  run_id?: string;
  error?: string;
}

export async function runReconciliationAction(): Promise<{ status: number; body: RunReconResponse }> {
  return callOpsRoute<RunReconResponse>("/api/reconciliation/run");
}

export interface ResolveFindingResponse {
  outcome?: string;
  finding_id?: number;
  error?: string;
}

export async function resolveFindingAction(
  finding_id: number,
): Promise<{ status: number; body: ResolveFindingResponse }> {
  return callOpsRoute<ResolveFindingResponse>("/api/reconciliation/resolve", { finding_id });
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
): Promise<{ status: number; body: RetryResponse }> {
  return callOpsRoute<RetryResponse>("/api/dlq/retry", { event_id });
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
): Promise<{ status: number; body: NlQueryResponse }> {
  return callOpsRoute<NlQueryResponse>("/api/nl-query", { question });
}
