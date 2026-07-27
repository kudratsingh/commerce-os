"use client";

import { useState } from "react";

import type { OrderRow } from "@/lib/queries/orders";
import { formatCents, relativeTime } from "@/lib/utils/format";

/**
 * NL query UI. Types a question, sends to /api/nl-query, gets back a
 * validated filter spec + result rows. Displays the spec next to the results
 * so the audience sees the safety story: the model proposes, zod disposes,
 * a hand-written query builder runs — the model never touches SQL.
 */

const SUGGESTIONS = [
  "Voltcore orders over $100 today",
  "PeakBlend allocated orders in the last 24 hours",
  "backordered orders",
  "TikTok Shop orders under $30 this week",
];

interface Response {
  spec?: Record<string, unknown>;
  rows?: OrderRow[];
  attempts?: number;
  raw_first?: string;
  raw_retry?: string;
  error?: string;
}

export function NLQueryBar() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Response | null>(null);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    setBusy(true);
    setResult(null);
    setQuestion(text);
    try {
      const res = await fetch("/api/nl-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const body = (await res.json()) as Response;
      setResult(body);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Ask about orders</div>
        <div className="text-[11px] text-text-muted">
          Model emits a JSON filter spec · zod validates · our query builder
          runs it. The model NEVER writes SQL (ADR-007).
        </div>
      </div>

      <div className="flex items-center gap-2 p-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          disabled={busy}
          placeholder="e.g. Voltcore orders over $100 today"
          className="flex-1 rounded border border-border-strong bg-bg px-3 py-2 text-sm placeholder:text-text-faint focus:border-accent/60 focus:outline-none disabled:opacity-60"
        />
        <button
          onClick={() => ask()}
          disabled={busy || !question.trim()}
          className={`mono text-[11px] uppercase tracking-wider px-3 py-2 rounded border transition-colors ${
            busy
              ? "border-warn/40 text-warn"
              : "border-accent/40 text-accent hover:bg-accent/10"
          } disabled:opacity-40`}
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => void ask(s)}
            disabled={busy}
            className="text-[11px] text-text-muted rounded border border-border px-2 py-0.5 hover:bg-panel-hover hover:text-text disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {result && (
        <div className="border-t border-border grid grid-cols-1 md:grid-cols-[280px_1fr]">
          <div className="border-r border-border p-3 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
                Filter spec {result.attempts ? `· ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}` : ""}
              </div>
              <pre className="mono mt-1 text-[11px] whitespace-pre-wrap break-words text-text">
                {result.spec ? JSON.stringify(result.spec, null, 2) : "—"}
              </pre>
            </div>
            {result.raw_first && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-text-muted">Raw model reply</summary>
                <pre className="mono mt-1 whitespace-pre-wrap break-words text-text-muted">
                  {result.raw_first}
                </pre>
                {result.raw_retry && (
                  <>
                    <div className="mt-2 text-text-faint">retry after zod errors:</div>
                    <pre className="mono mt-1 whitespace-pre-wrap break-words text-text-muted">
                      {result.raw_retry}
                    </pre>
                  </>
                )}
              </details>
            )}
            {result.error && (
              <div className="text-[11px] text-danger">{result.error}</div>
            )}
          </div>

          <div className="max-h-[360px] overflow-auto">
            {result.error ? (
              <div className="p-6 text-center text-sm text-danger">{result.error}</div>
            ) : (result.rows ?? []).length === 0 ? (
              <div className="p-6 text-center text-sm text-text-muted">
                Spec matched zero orders.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                    <th className="px-4 py-2 font-normal">Order</th>
                    <th className="px-2 py-2 font-normal">Brand · status</th>
                    <th className="px-2 py-2 font-normal">Placed</th>
                    <th className="px-4 py-2 font-normal text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.rows ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="mono px-4 py-2 text-xs">{r.external_order_id}</td>
                      <td className="px-2 py-2 text-[11px] text-text-muted">
                        {r.brand_name} ·{" "}
                        <span className="mono uppercase tracking-wider">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[11px] text-text-muted">
                        {relativeTime(r.placed_at)}
                      </td>
                      <td className="mono px-4 py-2 text-right">
                        {formatCents(r.subtotal_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
