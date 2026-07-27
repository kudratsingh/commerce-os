"use client";

import { useState } from "react";

import {
  fireScenarioAction,
  setHostileRateAction,
  skewChannelAction,
  sweepOutboxAction,
} from "@/lib/actions/ops-actions";

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
  | "return-latest"
  | "esi-count"
  | "esi-transfer"
  | "esi-damage";

interface Log {
  id: number;
  scenario: Scenario | "skew" | "hostile" | "sweep";
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

// ESI/ERP events — same webhook pipeline, different domain. ADR-011.
const ESI_BUTTONS: Array<{ scenario: Scenario; label: string; hint: string }> = [
  { scenario: "esi-count",    label: "ESI cycle count",  hint: "stock.counted — 115 vs our on_hand → adjustment" },
  { scenario: "esi-damage",   label: "ESI damage",       hint: "stock.damaged — 2 units gone, no receipt" },
  { scenario: "esi-transfer", label: "ESI transfer",     hint: "stock.transferred — paired out+in" },
];

export function ChaosPanel({ onFired }: { onFired?: () => void }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState<Scenario | "skew" | "hostile" | "sweep" | null>(null);
  const [hostilePct, setHostilePct] = useState<number>(0);

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

  async function applyHostility(pct: number) {
    setBusy("hostile");
    try {
      const { body } = await setHostileRateAction(pct / 100);
      if (body.error) {
        pushLog("hostile", false, body.error);
        return;
      }
      pushLog(
        "hostile",
        true,
        pct === 0
          ? "back to calm — every write succeeds"
          : `${pct}% of adapter writes will 429; sweeper retries with backoff`,
      );
    } catch (err) {
      pushLog("hostile", false, err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(null);
    }
  }

  async function sweep() {
    setBusy("sweep");
    try {
      const { body } = await sweepOutboxAction();
      if (body.error) {
        pushLog("sweep", false, body.error);
        return;
      }
      const parts: string[] = [];
      if (body.claimed !== undefined) parts.push(`claimed ${body.claimed}`);
      if (body.delivered) parts.push(`✓ ${body.delivered}`);
      if (body.retryable) parts.push(`↻ ${body.retryable}`);
      if (body.dead) parts.push(`☠ ${body.dead}`);
      if (body.permanent) parts.push(`⊘ ${body.permanent}`);
      pushLog("sweep", true, parts.join("  ·  ") || "nothing to do");
      onFired?.();
    } catch (err) {
      pushLog("sweep", false, err instanceof Error ? err.message : "network error");
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
        <button
          disabled={busy !== null}
          onClick={sweep}
          className={`rounded border text-left px-3 py-2 transition-colors ${
            busy === "sweep"
              ? "border-warn/40 bg-warn/5"
              : "border-accent/30 hover:border-accent/60 hover:bg-panel-hover"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <div className="text-sm font-medium">Sweep outbox now</div>
          <div className="text-[11px] text-text-muted">
            claim → dispatch through adapter → mark
          </div>
        </button>
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
          ESI / ERP · <span className="lowercase">on_hand syncs in</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          {ESI_BUTTONS.map((b) => (
            <button
              key={b.scenario}
              disabled={busy !== null}
              onClick={() => fire(b.scenario)}
              className={`rounded border text-left px-3 py-2 transition-colors ${
                busy === b.scenario
                  ? "border-warn/40 bg-warn/5"
                  : "border-info/30 hover:border-info/60 hover:bg-panel-hover"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <div className="text-sm font-medium">{b.label}</div>
              <div className="text-[11px] text-text-muted">{b.hint}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium">
              Hostile mode ·{" "}
              <span className="mono text-text-muted">
                simulator_config.hostile_rate = {(hostilePct / 100).toFixed(2)}
              </span>
            </div>
            <div className="text-[11px] text-text-muted">
              Fraction of adapter writes the fake responds to with a 429. Set
              non-zero, sweep, watch rows retry with exponential backoff.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[0, 15, 30, 60, 100].map((v) => (
              <button
                key={v}
                disabled={busy !== null}
                onClick={() => {
                  setHostilePct(v);
                  void applyHostility(v);
                }}
                className={`mono rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                  hostilePct === v
                    ? "border-warn/60 bg-warn/10"
                    : "border-border-strong hover:bg-panel-hover"
                }`}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>
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
