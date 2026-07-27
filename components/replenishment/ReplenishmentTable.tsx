import Link from "next/link";

import type { ReplenishmentAlertRow, Urgency } from "@/lib/queries/replenishment";
import { formatCents } from "@/lib/utils/format";

const URGENCY_ORDER: Record<Urgency, number> = { expedite: 0, reorder: 1, watch: 2 };
const URGENCY_CLS: Record<Urgency, string> = {
  expedite: "text-danger border-danger/40 bg-danger/10",
  reorder: "text-warn border-warn/40 bg-warn/10",
  watch: "text-info border-info/40 bg-info/10",
};

export function ReplenishmentTable({ rows }: { rows: ReplenishmentAlertRow[] }) {
  const sorted = [...rows].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
  return (
    <div className="rounded-md border border-border bg-panel">
      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          Nothing to reorder right now. Add reorder points via
          <span className="mono"> POST /api/reorder-points</span> to start alerts.
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">Urgency</th>
                <th className="px-2 py-2 font-normal">SKU · Brand</th>
                <th className="px-2 py-2 font-normal text-right">Available</th>
                <th className="px-2 py-2 font-normal text-right">Min / Target</th>
                <th className="px-2 py-2 font-normal text-right">Velocity /day</th>
                <th className="px-2 py-2 font-normal text-right">Days cover</th>
                <th className="px-2 py-2 font-normal">Primary supplier</th>
                <th className="px-2 py-2 font-normal text-right">Recommend</th>
                <th className="px-4 py-2 font-normal text-right">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const cost =
                  r.primary_unit_cost_cents !== null && r.recommended_qty !== null
                    ? r.primary_unit_cost_cents * r.recommended_qty
                    : null;
                return (
                  <tr key={`${r.product_id}-${r.location_id}`} className="border-t border-border/60 hover:bg-panel-hover">
                    <td className="px-4 py-2">
                      <span className={`mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${URGENCY_CLS[r.urgency]}`}>
                        {r.urgency}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="mono text-xs">{r.sku}</div>
                      <div className="text-[11px] text-text-muted">{r.brand_name}</div>
                    </td>
                    <td className="mono px-2 py-2 text-right">{r.available}</td>
                    <td className="mono px-2 py-2 text-right text-text-muted">
                      {r.min_qty ?? "—"} / {r.target_qty ?? "—"}
                    </td>
                    <td className="mono px-2 py-2 text-right">{r.velocity_per_day}</td>
                    <td className="mono px-2 py-2 text-right">
                      {r.days_of_cover !== null ? `${r.days_of_cover}d` : "—"}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-text-muted">
                      {r.primary_supplier_name ?? "—"}
                      {r.primary_lead_time_days !== null && (
                        <span className="block text-text-faint">
                          {r.primary_lead_time_days}d lead time
                        </span>
                      )}
                    </td>
                    <td className="mono px-2 py-2 text-right font-semibold">
                      {r.recommended_qty ?? "—"}
                    </td>
                    <td className="mono px-4 py-2 text-right">
                      {cost !== null ? (
                        <Link
                          href={`/purchasing/new?brand=${r.brand_id}&product=${r.product_id}&qty=${r.recommended_qty}`}
                          className="text-accent hover:underline"
                        >
                          {formatCents(cost)}
                        </Link>
                      ) : (
                        "—"
                      )}
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
