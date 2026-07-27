import { AgedInventoryTable } from "@/components/inventory/AgedInventoryTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getAgedInventory } from "@/lib/queries/purchasing";
import { formatCents } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgedInventoryPage() {
  const db = createSupabaseServer();
  const rows = await getAgedInventory(db, { limit: 200 });

  const totalAtRisk = rows.reduce((s, r) => s + r.dollars_at_risk_cents, 0);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Aged inventory</h1>
          <p className="text-[11px] text-text-muted">
            SKUs with <span className="mono">on_hand &gt; 0</span> sorted by
            capital tied up. Landed cost averaged from
            <span className="mono"> landed_costs </span>(last 365 days), falling
            back to <span className="mono">products.cost_cents</span>.
          </p>
        </div>
        <div className="rounded-md border border-border bg-panel px-4 py-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Total dollars at risk
          </div>
          <div className="mono text-xl font-semibold text-warn">
            {formatCents(totalAtRisk)}
          </div>
        </div>
      </div>
      <AgedInventoryTable rows={rows} />
    </div>
  );
}
