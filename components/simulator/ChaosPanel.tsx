"use client";

import { useState } from "react";

import { fireScenarioAction, skewChannelAction } from "@/lib/actions/ops-actions";

/**
 * Chaos buttons + a running result log. Server actions proxy to
 * /api/simulator/* with the ops secret attached server-side; the routes
 * remain gated for external callers (invariant #8).
 */

type Scenario =
  | "one"
  | "burst"
  | "duplicate"
  | "malformed"
  | "bad-signature"
  | "unknown-sku"
  | "overshoot"
  | "invalid-json"
  | "ship-latest"
  | "return-latest";

interface Log {
  id: number;
  scenario: Scenario | "skew";
  ok: boolean;
  detail: string;
  at: string;
}

const BUTTONS: Array<{ scenario: Scenario; label: string; hint: string; danger?: boolean }> = [
  { scenario: "one",            label: "Send order",       hint: "order.created — 1 unit" },
  { scenario: "burst",          label: "Burst 50",         hint: "50 random orders in parallel" },
  { scenario: "duplicate",      label: "Duplicate",        hint: "same event_id twice" },
  { scenario: "ship-latest",    label: "Ship latest",      hint: "order.shipped — on_hand −qty" },
  { scenario: "return-latest",  label: "Return latest",    hint: "order.returned — on_hand +qty" },
  { scenario: "unknown-sku",    label: "Unknown SKU",      hint: "→ DLQ, retryable" },
  { scenario: "overshoot",      label: "Overshoot",        hint: "qty 99999 → backordered" },
  { scenario: "malformed",      label: "Malformed",        hint: "missing required fields" },
  { scenario: "bad-signature",  label: "Bad signature",    hint: "→ dead, not retryable", danger: true },
  { scenario: "invalid-json",   label: "Invalid JSON",     hint: "unparseable body" },
];

export function ChaosPanel({ onFired }: { onFired?: () => void }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState<Scenario | "skew" | null>(null);

  async function fire(scenario: Scenario) {
    setBusy(scenario);
    try {
      const { body } = await fireScenarioAction(scenario);
      if (body.error) {
        pushLog(scenario, false, body.error);
        return;
      }
      const summary = summarize(body.results ?? []);
      pushLog(scenario, true, `${body.fired}× → ${summary}`);
      onFired?.();
    } catch (err) {
      pushLog(scenario, false, err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(null);
    }
  }

  async function skew() {
    setBusy("skew");
    try {
      const { body } = await skewChannelAction("tiktok_shop", "TTS-VC-BT-100", 7);
      if (body.error) {
        pushLog("skew", false, body.error);
        return;
      }
      pushLog(
        "skew",
        true,
        `TTS-VC-BT-100 reported=${body.reported} vs available=${body.available} — run reconciliation`,
      );
      onFired?.();
    } catch (err) {
      pushLog("skew", false, err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(null);
    }
  }

  function pushLog(scenario: Log["scenario"], ok: boolean, detail: string) {
    setLogs((prev) =>
      [
        {
          id: Date.now() + Math.random(),
          scenario,
          ok,
          detail,
          at: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 20),
    );
  }

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Chaos simulator</div>
        <div className="text-[11px] text-text-muted">
          Each button signs a payload server-side and fires it at
          <span className="mono"> /api/webhooks/tiktok </span>
          on this worker — the real ingestion path (ADR-008).
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
        {BUTTONS.map((b) => (
          <button
            key={b.scenario}
            disabled={busy !== null}
            onClick={() => fire(b.scenario)}
            className={`rounded border text-left px-3 py-2 transition-colors ${
              busy === b.scenario
                ? "border-warn/40 bg-warn/5"
                : b.danger
                  ? "border-danger/30 hover:border-danger/60 hover:bg-panel-hover"
                  : "border-border-strong hover:bg-panel-hover"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <div className="text-sm font-medium">{b.label}</div>
            <div className="text-[11px] text-text-muted">{b.hint}</div>
          </button>
        ))}
        <button
          disabled={busy !== null}
          onClick={skew}
          className={`rounded border text-left px-3 py-2 transition-colors ${
            busy === "skew"
              ? "border-warn/40 bg-warn/5"
              : "border-info/30 hover:border-info/60 hover:bg-panel-hover"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <div className="text-sm font-medium">Skew channel report</div>
          <div className="text-[11px] text-text-muted">
            TTS-VC-BT-100 +7 → next recon finds it
          </div>
        </button>
      </div>
      {logs.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2 text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Recent fires
          </div>
          <div className="max-h-[220px] overflow-auto divide-y divide-border/60 text-sm">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-1.5">
                <span
                  className={`mono text-[10px] uppercase tracking-wider ${
                    log.ok ? "text-accent" : "text-danger"
                  }`}
                >
                  {log.scenario}
                </span>
                <span className="flex-1 truncate text-text-muted">
                  {log.detail}
                </span>
                <span className="mono text-[10px] text-text-faint">
                  {new Date(log.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function summarize(
  results: Array<{ status: number; body: { status?: string; deduped?: boolean; error?: string } }>,
): string {
  const buckets: Record<string, number> = {};
  for (const r of results) {
    const key =
      r.body?.deduped
        ? "deduped"
        : r.body?.status
          ? r.body.status
          : r.body?.error
            ? "error"
            : `http-${r.status}`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  return Object.entries(buckets)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
}
