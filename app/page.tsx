import { DlqPanel } from "@/components/dashboard/DlqPanel";
import { LiveOrderFeed } from "@/components/dashboard/LiveOrderFeed";
import { StatCards } from "@/components/dashboard/StatCards";
import { StockTable } from "@/components/dashboard/StockTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getDlqEvents } from "@/lib/queries/dlq";
import { getRecentOrders } from "@/lib/queries/orders";
import { getStockLevels } from "@/lib/queries/stock";
import { getDashboardSummary } from "@/lib/queries/summary";

/**
 * Ops dashboard. Server component: every SSR query is a named view over
 * the append-only ledger (BUILD_PLAN day 3 discipline — "every number is
 * sourced from a view you can name"). The Realtime feed is the only
 * client-heavy island; everything else is pushed HTML.
 */

// The dashboard reads live state; there's no static shape to cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const db = createSupabaseServer();

  const [summary, stock, orders, dlq] = await Promise.all([
    getDashboardSummary(db),
    getStockLevels(db, 200),
    getRecentOrders(db, 40),
    getDlqEvents(db, 25),
  ]);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-5">
      <StatCards summary={summary} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <StockTable rows={stock} />
        <LiveOrderFeed initial={orders} />
      </div>

      <DlqPanel rows={dlq} />

      <footer className="pt-2 text-[11px] text-text-faint">
        Every number on this page is a SQL view over the append-only ledger —{" "}
        <span className="mono">dashboard_summary</span>,{" "}
        <span className="mono">stock_dashboard</span>,{" "}
        <span className="mono">recent_orders</span>,{" "}
        <span className="mono">dlq_events</span>. See docs/architecture.md.
      </footer>
    </div>
  );
}
