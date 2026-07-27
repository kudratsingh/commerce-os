import Link from "next/link";

import type { PurchaseOrderRow } from "@/lib/queries/purchasing";
import { formatCents, relativeTime } from "@/lib/utils/format";

const STATUS_CLS: Record<string, string> = {
  received: "text-accent",
  closed: "text-text-muted",
  partially_received: "text-warn",
  placed: "text-info",
  draft: "text-text-faint",
};

export function POTable({ rows }: { rows: PurchaseOrderRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Purchase orders</div>
        <div className="text-[11px] text-text-muted">{rows.length} POs</div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          No POs yet. Click <span className="mono">+ New PO</span> to create one.
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">PO</th>
                <th className="px-2 py-2 font-normal">Brand</th>
                <th className="px-2 py-2 font-normal">Supplier</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal text-right">Lines</th>
                <th className="px-2 py-2 font-normal text-right">Received / Ordered</th>
                <th className="px-2 py-2 font-normal text-right">Total cost</th>
                <th className="px-4 py-2 font-normal">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-panel-hover">
                  <td className="px-4 py-2">
                    <Link href={`/purchasing/${r.id}`} className="mono text-xs text-accent hover:underline">
                      {r.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-2 py-2">{r.brand_name}</td>
                  <td className="px-2 py-2 text-text-muted">{r.supplier_name ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className={`mono text-[10px] uppercase tracking-wider ${STATUS_CLS[r.status] ?? "text-text"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="mono px-2 py-2 text-right">{r.line_count}</td>
                  <td className="mono px-2 py-2 text-right">
                    {r.qty_received} / {r.qty_ordered}
                    <span className="ml-2 text-[10px] text-text-faint">
                      {(r.receive_fraction * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="mono px-2 py-2 text-right">{formatCents(r.total_cost_cents)}</td>
                  <td className="px-4 py-2 text-[11px] text-text-muted whitespace-nowrap">
                    {relativeTime(r.created_at)}
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
