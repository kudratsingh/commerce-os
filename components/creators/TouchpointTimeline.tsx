import type { TouchpointRow } from "@/lib/queries/creators";

/**
 * The creator's timeline. Every row is a fact from `creator_touchpoints`
 * — corrections are new rows, not edits (ADR-012). Reads top-down, most
 * recent first.
 */

const KIND_LABEL: Record<string, string> = {
  outreach: "Outreach",
  reply: "Reply",
  call: "Call",
  meeting: "Meeting",
  sample_request: "Sample requested",
  sample_ship: "Sample shipped",
  contract: "Contract",
  payment: "Payment",
  other: "Note",
};

const KIND_COLOR: Record<string, string> = {
  outreach: "text-info",
  reply: "text-warn",
  call: "text-info",
  meeting: "text-info",
  sample_request: "text-warn",
  sample_ship: "text-accent",
  contract: "text-accent",
  payment: "text-accent",
  other: "text-text-muted",
};

export function TouchpointTimeline({ rows }: { rows: TouchpointRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-panel p-6 text-center text-sm text-text-muted">
        No touchpoints yet. Log the first outreach above and the timeline
        will start.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Timeline</div>
        <div className="text-[11px] text-text-muted">
          {rows.length} touchpoint{rows.length === 1 ? "" : "s"} · append-only
          (ADR-012)
        </div>
      </div>
      <ol className="divide-y divide-border/60">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-4 px-4 py-3">
            <div className="min-w-[3px] self-stretch bg-border rounded-full" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`mono text-[10px] uppercase tracking-wider ${KIND_COLOR[r.kind] ?? "text-text"}`}
                >
                  {KIND_LABEL[r.kind] ?? r.kind}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text-faint">
                  {r.direction === "inbound" ? "← from creator" : "→ to creator"}
                </span>
                {r.medium && (
                  <span className="text-[10px] text-text-muted">
                    · {r.medium}
                  </span>
                )}
              </div>
              {r.notes && (
                <div className="mt-1 text-sm text-text whitespace-pre-wrap">
                  {r.notes}
                </div>
              )}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
                <span className="mono">{formatDateTime(r.occurred_at)}</span>
                {r.actor && <span>· by {r.actor}</span>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
