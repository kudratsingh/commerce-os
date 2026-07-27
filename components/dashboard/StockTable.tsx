import type { StockRow } from "@/lib/queries/stock";

/**
 * Stock levels per product+location. `available` = on_hand − committed
 * (never a stored counter — invariant #2). Low-stock rows sort to the top.
 */
export function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Stock levels</div>
          <div className="text-[11px] text-text-muted">
            Every row is the current sum of the append-only ledger. Low-stock
            threshold = 20 units.
          </div>
        </div>
        <div className="text-[11px] text-text-muted">
          {rows.length} SKU × location
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
              <th className="px-4 py-2 font-normal">Brand · SKU</th>
              <th className="px-4 py-2 font-normal">Product</th>
              <th className="px-2 py-2 font-normal text-right">On hand</th>
              <th className="px-2 py-2 font-normal text-right">Committed</th>
              <th className="px-2 py-2 font-normal text-right">Available</th>
              <th className="px-4 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.product_id}-${r.location_id}`}
                className="border-t border-border/60 hover:bg-panel-hover"
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="text-[11px] text-text-muted">
                    {r.brand_name}
                  </div>
                  <div className="mono text-xs">{r.sku}</div>
                </td>
                <td className="px-4 py-2">
                  <div className="truncate max-w-[240px]" title={r.title}>
                    {r.title}
                  </div>
                  <div className="text-[10px] text-text-faint">
                    {r.location_name}
                  </div>
                </td>
                <td className="mono px-2 py-2 text-right">{r.on_hand}</td>
                <td className="mono px-2 py-2 text-right text-text-muted">
                  {r.committed}
                </td>
                <td
                  className={`mono px-2 py-2 text-right font-semibold ${
                    r.low_stock ? "text-warn" : "text-text"
                  }`}
                >
                  {r.available}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right">
                  {r.low_stock ? (
                    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warn">
                      Low
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
