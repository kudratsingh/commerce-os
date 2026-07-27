import Link from "next/link";

import { CreatorFilters } from "@/components/creators/CreatorFilters";
import { CreatorsTable } from "@/components/creators/CreatorsTable";
import { createSupabaseServer } from "@/lib/db/server";
import { getCreators } from "@/lib/queries/creators";
import type { CreatorStatus } from "@/lib/domain/creators";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /creators — the CRM home. Table renders directly from `creators`.
 * Status is derived from the touchpoint stream, so this is a read-only
 * projection of the ledger (ADR-012).
 */
export default async function CreatorsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; platform?: string; search?: string }>;
}) {
  const params = await searchParams;
  const db = createSupabaseServer();

  const filter = {
    status: parseStatus(params.status),
    platform: params.platform || undefined,
    search: params.search || undefined,
    limit: 200,
  };
  const rows = await getCreators(db, filter);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Creators</h1>
          <p className="text-[11px] text-text-muted">
            Outreach through payout. Status is derived from
            <span className="mono"> creator_touchpoints </span>— corrections are
            new rows, not edits.
          </p>
        </div>
        <Link
          href="/creators/new"
          className="mono text-[11px] uppercase tracking-wider px-3 py-2 rounded border border-accent/40 text-accent hover:bg-accent/10"
        >
          + New creator
        </Link>
      </div>
      <CreatorFilters />
      <CreatorsTable rows={rows} />
    </div>
  );
}

function parseStatus(value?: string): CreatorStatus | undefined {
  if (!value) return undefined;
  const valid: CreatorStatus[] = [
    "prospect",
    "contacted",
    "replied",
    "accepted",
    "active",
    "declined",
    "blocked",
  ];
  return valid.includes(value as CreatorStatus) ? (value as CreatorStatus) : undefined;
}
