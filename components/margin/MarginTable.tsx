import type { SkuMarginRow } from "@/lib/queries/margin";
import { formatCents } from "@/lib/utils/format";

export function MarginTable({ rows }: { rows: SkuMarginRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          No margin snapshots yet. Ship orders through
          <span className="mono"> ship_order </span>and margin lands here
          per-line, per-order (migration 011).
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">SKU · Brand</th>
                <th className="px-2 py-2 font-normal">Channel</th>
                <th className="px-2 py-2 font-normal text-right">Orders (30d)</th>
                <th className="px-2 py-2 font-normal text-right">Avg gross</th>
                <th className="px-2 py-2 font-normal text-right">Avg fee</th>
                <th className="px-2 py-2 font-normal text-right">Avg landed</th>
                <th className="px-2 py-2 font-normal text-right">Avg net</th>
                <th className="px-4 py-2 font-normal text-right">Net %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pctClass =
                  r.net_margin_pct === null
                    ? "text-text-muted"
                    : r.net_margin_pct < 0
                      ? "text-danger"
                      : r.net_margin_pct < 5
                        ? "text-warn"
                        : "text-accent";
                return (
                  <tr key={`${r.product_id}-${r.channel_id}`} className="border-t border-border/60 hover:bg-panel-hover">
                    <td className="px-4 py-2">
                      <div className="mono text-xs">{r.sku}</div>
                      <div className="text-[11px] text-text-muted">{r.brand_name}</div>
                    </td>
                    <td className="mono px-2 py-2 text-[11px] text-text-muted">
                      {r.channel_id}
                    </td>
                    <td className="mono px-2 py-2 text-right">{r.orders_in_window}</td>
                    <td className="mono px-2 py-2 text-right">
                      {formatCents(r.avg_gross_revenue_cents)}
                    </td>
                    <td className="mono px-2 py-2 text-right text-text-muted">
                      {formatCents(r.avg_fee_cents)}
                    </td>
                    <td className="mono px-2 py-2 text-right text-text-muted">
                      {formatCents(r.avg_landed_cost_cents)}
                    </td>
                    <td className={`mono px-2 py-2 text-right font-semibold ${pctClass}`}>
                      {formatCents(r.avg_net_margin_cents)}
                    </td>
                    <td className={`mono px-4 py-2 text-right font-semibold ${pctClass}`}>
                      {r.net_margin_pct !== null ? `${r.net_margin_pct}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
