import Link from "next/link";

import { POTable } from "@/components/purchasing/POTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getPurchaseOrders } from "@/lib/queries/purchasing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PurchasingListPage() {
  const db = createSupabaseServer();
  const orders = await getPurchaseOrders(db, { limit: 100 });

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Purchase orders</h1>
          <p className="text-[11px] text-text-muted">
            Every PO in the ledger. Receive against a line to write to
            <span className="mono"> stock_movements </span>+
            <span className="mono"> landed_costs </span>atomically.
          </p>
        </div>
        <Link
          href="/purchasing/new"
          className="mono text-[11px] uppercase tracking-wider px-3 py-2 rounded border border-accent/40 text-accent hover:bg-accent/10"
        >
          + New PO
        </Link>
      </div>
      <POTable rows={orders} />
    </div>
  );
}
