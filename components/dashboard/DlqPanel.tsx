import type { DlqRow } from "@/lib/queries/dlq";
import { relativeTime } from "@/lib/utils/format";
import { RetryButton } from "./RetryButton";

/**
 * Failed + dead webhook events. Retryable rows get a Retry button (POST to
 * /api/dlq/retry, then router.refresh). Dead rows are refused by the RPC
 * because they represent bad-signature or max-attempt states that need
 * root cause, not another try.
 */
export function DlqPanel({ rows }: { rows: DlqRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Dead letter queue</div>
          <div className="text-[11px] text-text-muted">
            {"'failed'"} rows are retryable once the root cause is fixed
            (usually a missing channel_listing). {"'dead'"} rows need
            investigation.
          </div>
        </div>
        <div className="text-[11px] text-text-muted">
          {rows.length} event{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          Empty. Nothing to triage.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">Event</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">Attempts</th>
                <th className="px-4 py-2 font-normal">Last error</th>
                <th className="px-4 py-2 font-normal">Received</th>
                <th className="px-4 py-2 font-normal text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top hover:bg-panel-hover">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="mono text-xs">{r.external_event_id}</div>
                    <div className="text-[11px] text-text-muted">
                      {r.event_type}
                      {r.external_order_id && (
                        <>
                          {" · "}
                          <span className="mono">{r.external_order_id}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`mono text-[10px] uppercase tracking-wider ${
                        r.status === "dead" ? "text-danger" : "text-warn"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="mono px-2 py-2 text-text-muted">{r.attempts}</td>
                  <td className="px-4 py-2 text-[12px] text-danger max-w-[380px] truncate" title={r.last_error ?? undefined}>
                    {r.last_error ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-muted whitespace-nowrap">
                    {relativeTime(r.received_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RetryButton eventId={r.id} disabled={r.status === "dead"} />
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
