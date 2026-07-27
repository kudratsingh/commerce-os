import { MarginTable } from "@/components/margin/MarginTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getSkuMarginByChannel } from "@/lib/queries/margin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarginPage() {
  const db = createSupabaseServer();
  const rows = await getSkuMarginByChannel(db, { limit: 200 });

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Margin by SKU × channel</h1>
        <p className="text-[11px] text-text-muted">
          Rolling 30 days from <span className="mono">margin_snapshots</span>.
          Snapshots written at ship time (migration 011) — gross − fee (from
          time-versioned <span className="mono">fee_schedules</span>) − landed
          cost (avg of last 365 days of landings).
        </p>
      </div>
      <MarginTable rows={rows} />
    </div>
  );
}
