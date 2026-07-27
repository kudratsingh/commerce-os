"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { resolveFindingAction, runReconciliationAction } from "@/lib/actions/ops-actions";
import type { FindingRow, ReconRunRow } from "@/lib/queries/findings";

/**
 * Reconciliation panel. "Run now" button + a table of open findings + a
 * per-row Resolve action. Every finding is a channel_drift or ledger_drift
 * discovered by `run_reconciliation()` — trust, verified.
 */
export function ReconciliationPanel({
  findings,
  runs,
}: {
  findings: FindingRow[];
  runs: ReconRunRow[];
}) {
  const router = useRouter();
  const [running, startRunning] = useTransition();
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function runNow() {
    setErr(null);
    startRunning(async () => {
      try {
        const { body } = await runReconciliationAction();
        if (body.error) {
          setErr(body.error);
          return;
        }
        setLastRun(body.run_id ?? null);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "run failed");
      }
    });
  }

  async function resolve(findingId: number, strategy: "ack" | "accept_source" = "ack") {
    setResolvingId(findingId);
    setErr(null);
    try {
      const { body } = await resolveFindingAction(findingId, strategy);
      if (body.error) {
        setErr(body.error);
        return;
      }
      router.refresh();
    } finally {
      setResolvingId(null);
    }
  }

  const latestRun = runs[0];

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Reconciliation</div>
          <div className="text-[11px] text-text-muted">
            <span className="mono">run_reconciliation()</span> proves the
            rollup matches the ledger AND compares our available-to-sell to
            each marketplace&apos;s last report.
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latestRun && (
            <div className="text-[11px] text-text-muted">
              last run:{" "}
              <span className="mono text-text">
                {latestRun.findings_count ?? "?"} finding
                {latestRun.findings_count === 1 ? "" : "s"}
              </span>{" "}
              in <span className="mono">{Math.round(latestRun.elapsed_ms ?? 0)}ms</span>
            </div>
          )}
          <button
            disabled={running}
            onClick={runNow}
            className={`mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              running
                ? "border-warn/40 text-warn"
                : "border-accent/40 text-accent hover:bg-accent/10"
            } disabled:opacity-60`}
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {err && (
        <div className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-[11px] text-danger">
          {err}
        </div>
      )}

      {findings.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          {lastRun
            ? "Run completed. No open findings — ledger and rollup agree, and every marketplace's report matches ours."
            : "No open findings. Skew a channel or run a fresh reconciliation."}
        </div>
      ) : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">Kind</th>
                <th className="px-2 py-2 font-normal">Product</th>
                <th className="px-2 py-2 font-normal">Where</th>
                <th className="px-2 py-2 font-normal text-right">Expected</th>
                <th className="px-2 py-2 font-normal text-right">Actual</th>
                <th className="px-2 py-2 font-normal text-right">Δ</th>
                <th className="px-4 py-2 font-normal text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id} className="border-t border-border/60 hover:bg-panel-hover">
                  <td className="px-4 py-2">
                    <span
                      className={`mono text-[10px] uppercase tracking-wider ${
                        f.kind === "ledger_drift"
                          ? "text-danger"
                          : f.kind === "erp_drift"
                            ? "text-info"
                            : "text-warn"
                      }`}
                    >
                      {f.kind === "ledger_drift"
                        ? "ledger"
                        : f.kind === "erp_drift"
                          ? "erp"
                          : "channel"}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="mono text-xs">{f.sku}</div>
                    <div className="text-[11px] text-text-muted truncate max-w-[240px]" title={f.title}>
                      {f.brand_name} · {f.title}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[11px] text-text-muted">
                    {f.location_name ?? f.channel_id ?? "—"}
                  </td>
                  <td className="mono px-2 py-2 text-right">{f.expected}</td>
                  <td className="mono px-2 py-2 text-right">{f.actual}</td>
                  <td
                    className={`mono px-2 py-2 text-right font-semibold ${
                      f.delta > 0 ? "text-warn" : "text-danger"
                    }`}
                  >
                    {f.delta > 0 ? `+${f.delta}` : f.delta}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {f.kind === "erp_drift" && (
                        <button
                          onClick={() => resolve(f.id, "accept_source")}
                          disabled={resolvingId === f.id}
                          className="mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-info/60 text-info hover:bg-info/10 disabled:opacity-60"
                          title="Accept ESI's on_hand as truth — appends an adjustment ledger movement"
                        >
                          {resolvingId === f.id ? "…" : "Accept ESI"}
                        </button>
                      )}
                      <button
                        onClick={() => resolve(f.id, "ack")}
                        disabled={resolvingId === f.id}
                        className="mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-border-strong text-text hover:bg-panel-hover disabled:opacity-60"
                      >
                        {resolvingId === f.id ? "…" : "Ack"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
