import { ReplenishmentTable } from "@/components/replenishment/ReplenishmentTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getReplenishmentAlerts } from "@/lib/queries/replenishment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReplenishmentPage() {
  const db = createSupabaseServer();
  const alerts = await getReplenishmentAlerts(db, { limit: 200 });

  const grouped = {
    expedite: alerts.filter((a) => a.urgency === "expedite").length,
    reorder: alerts.filter((a) => a.urgency === "reorder").length,
    watch: alerts.filter((a) => a.urgency === "watch").length,
  };

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Replenishment</h1>
        <p className="text-[11px] text-text-muted">
          Every alert is a call to <span className="mono">compute_reorder_signals</span>.
          Velocity × supplier lead time picks the urgency; the recommended qty
          respects supplier MOQ.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <UrgencyCard label="Expedite" count={grouped.expedite} accent="danger" hint="available ≤ min_qty" />
        <UrgencyCard label="Reorder" count={grouped.reorder} accent="warn" hint="days-of-cover < lead time" />
        <UrgencyCard label="Watch" count={grouped.watch} accent="info" hint="below target, not urgent" />
      </div>

      <ReplenishmentTable rows={alerts} />
    </div>
  );
}

function UrgencyCard({
  label,
  count,
  hint,
  accent,
}: {
  label: string;
  count: number;
  hint: string;
  accent: "accent" | "warn" | "danger" | "info";
}) {
  const cls =
    accent === "danger"
      ? "text-danger"
      : accent === "warn"
        ? "text-warn"
        : accent === "info"
          ? "text-info"
          : "text-accent";
  return (
    <div className="rounded-md border border-border bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className={`mono mt-1 text-2xl font-semibold ${cls}`}>{count}</div>
      <div className="text-[11px] text-text-muted">{hint}</div>
    </div>
  );
}
