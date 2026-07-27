import { formatCents, formatCompact } from "@/lib/utils/format";
import type { DashboardSummary } from "@/lib/queries/summary";

/**
 * Top-of-page stat strip. Eight tiles rendered from `dashboard_summary`
 * (single-row view, one query). Muted color per metric type — value is the
 * loud element, label is quiet, footnote quieter still.
 *
 * Grouping (visual): revenue-shape metrics first (GMV, backordered,
 * shipped, returned), then ingestion-shape metrics (ingested, processed,
 * failed, dead). The DLQ count is elsewhere (in the DLQ panel header).
 */
export function StatCards({ summary }: { summary: DashboardSummary }) {
  const cards: Array<{
    label: string;
    value: string;
    footnote?: string;
    accent?: "accent" | "warn" | "danger" | "info";
  }> = [
    {
      label: "GMV today",
      value: formatCents(summary.gmv_cents),
      footnote: `${summary.orders_count} orders`,
      accent: "accent",
    },
    {
      label: "Backordered",
      value: formatCompact(summary.backordered_count),
      footnote: "not shippable now",
      accent: summary.backordered_count > 0 ? "warn" : undefined,
    },
    {
      label: "Shipped",
      value: formatCompact(summary.shipped_count),
      footnote: "on_hand −qty today",
      accent: summary.shipped_count > 0 ? "info" : undefined,
    },
    {
      label: "Returned",
      value: formatCompact(summary.returned_count),
      footnote: "on_hand +qty today",
      accent: summary.returned_count > 0 ? "warn" : undefined,
    },
    {
      label: "Ingested",
      value: formatCompact(
        summary.received_count +
          summary.processed_count +
          summary.failed_count +
          summary.dead_count,
      ),
      footnote: "webhook events today",
    },
    {
      label: "Processed",
      value: formatCompact(summary.processed_count),
      footnote: "committed to ledger",
      accent: "accent",
    },
    {
      label: "Failed",
      value: formatCompact(summary.failed_count),
      footnote: "retryable in DLQ",
      accent: summary.failed_count > 0 ? "warn" : undefined,
    },
    {
      label: "Dead",
      value: formatCompact(summary.dead_count),
      footnote: "bad sig / max attempts",
      accent: summary.dead_count > 0 ? "danger" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map((c) => (
        <StatTile key={c.label} {...c} />
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  footnote,
  accent,
}: {
  label: string;
  value: string;
  footnote?: string;
  accent?: "accent" | "warn" | "danger" | "info";
}) {
  const valueClass =
    accent === "warn"
      ? "text-warn"
      : accent === "danger"
        ? "text-danger"
        : accent === "accent"
          ? "text-accent"
          : accent === "info"
            ? "text-info"
            : "text-text";
  return (
    <div className="rounded-md border border-border bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className={`mono mt-1 text-xl font-semibold ${valueClass}`}>
        {value}
      </div>
      {footnote && (
        <div className="mt-0.5 text-[11px] text-text-muted">{footnote}</div>
      )}
    </div>
  );
}
