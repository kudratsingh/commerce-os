import type { AgedInventoryRow } from "@/lib/queries/purchasing";
import { formatCents } from "@/lib/utils/format";

export function AgedInventoryTable({ rows }: { rows: AgedInventoryRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
              <th className="px-4 py-2 font-normal">SKU · Brand</th>
              <th className="px-2 py-2 font-normal">Location</th>
              <th className="px-2 py-2 font-normal text-right">On hand</th>
              <th className="px-2 py-2 font-normal text-right">Days since shipment</th>
              <th className="px-2 py-2 font-normal text-right">Unit cost</th>
              <th className="px-4 py-2 font-normal text-right">Dollars at risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ageClass =
                r.days_since_last_shipment > 60
                  ? "text-danger"
                  : r.days_since_last_shipment > 30
                    ? "text-warn"
                    : "text-text-muted";
              return (
                <tr key={`${r.product_id}-${r.location_id}`} className="border-t border-border/60 hover:bg-panel-hover">
                  <td className="px-4 py-2">
                    <div className="mono text-xs">{r.sku}</div>
                    <div className="text-[11px] text-text-muted">{r.brand_name}</div>
                  </td>
                  <td className="px-2 py-2 text-[11px] text-text-muted">
                    {r.location_name}
                  </td>
                  <td className="mono px-2 py-2 text-right">{r.on_hand}</td>
                  <td className={`mono px-2 py-2 text-right ${ageClass}`}>
                    {r.days_since_last_shipment.toFixed(0)}
                  </td>
                  <td className="mono px-2 py-2 text-right text-text-muted">
                    {formatCents(r.unit_cost_cents)}
                  </td>
                  <td className="mono px-4 py-2 text-right font-semibold text-warn">
                    {formatCents(r.dollars_at_risk_cents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
