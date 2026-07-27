import { notFound } from "next/navigation";

import { POCloseButton } from "@/components/purchasing/POCloseButton";
import { POLinesTable } from "@/components/purchasing/POLinesTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getPurchaseOrderDetail } from "@/lib/queries/purchasing";
import { formatCents, relativeTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createSupabaseServer();
  const po = await getPurchaseOrderDetail(db, id);
  if (!po) notFound();

  const closed = po.status === "closed";
  const fullyReceived = po.receive_fraction >= 1;

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            PO · {po.brand_name}
          </div>
          <h1 className="mono text-lg font-semibold">{po.id.slice(0, 8)}…</h1>
          <div className="text-[11px] text-text-muted">
            {po.supplier_name ?? "—"} · created {relativeTime(po.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={po.status} />
          <POCloseButton poId={po.id} disabled={closed} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total cost" value={formatCents(po.total_cost_cents)} />
        <Tile label="Lines" value={String(po.line_count)} />
        <Tile
          label="Received"
          value={`${po.qty_received} / ${po.qty_ordered}`}
          accent={fullyReceived ? "accent" : undefined}
        />
        <Tile label="Days outstanding" value={po.days_outstanding.toFixed(0)} />
      </div>

      <POLinesTable poId={po.id} lines={po.lines} disabled={closed} />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "received"
      ? "text-accent border-accent/40"
      : status === "closed"
        ? "text-text-muted border-border"
        : status === "partially_received"
          ? "text-warn border-warn/40"
          : "text-info border-info/40";
  return (
    <span
      className={`mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${cls}`}
    >
      {status}
    </span>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "accent" | "warn";
}) {
  const cls =
    accent === "accent" ? "text-accent" : accent === "warn" ? "text-warn" : "text-text";
  return (
    <div className="rounded-md border border-border bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
