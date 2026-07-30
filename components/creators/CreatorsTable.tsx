import Link from "next/link";

import type { CreatorRow } from "@/lib/queries/creators";
import { relativeTime } from "@/lib/utils/format";

import { CreatorStatusPill } from "./CreatorStatusPill";

export function CreatorsTable({ rows }: { rows: CreatorRow[] }) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Creators</div>
        <div className="text-[11px] text-text-muted">
          {rows.length} {rows.length === 1 ? "creator" : "creators"} · status
          derived from the touchpoint stream (ADR-012)
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-muted">
          No creators match this filter. Try clearing the filters, or
          <Link href="/creators/new" className="text-accent hover:underline">
            {" "}
            add one
          </Link>
          .
        </div>
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
                <th className="px-4 py-2 font-normal">Handle</th>
                <th className="px-2 py-2 font-normal">Platform</th>
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal text-right">Followers</th>
                <th className="px-2 py-2 font-normal text-right">Engagement</th>
                <th className="px-2 py-2 font-normal">Categories</th>
                <th className="px-4 py-2 font-normal">Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border/60 hover:bg-panel-hover"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/creators/${r.id}`}
                      className="mono text-xs text-accent hover:underline"
                    >
                      {r.handle}
                    </Link>
                    {r.display_name && (
                      <div className="text-[11px] text-text-muted">
                        {r.display_name}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-text-muted">
                    {r.platform}
                  </td>
                  <td className="px-2 py-2">
                    <CreatorStatusPill status={r.status} />
                  </td>
                  <td className="mono px-2 py-2 text-right">
                    {r.follower_count !== null
                      ? formatCompact(r.follower_count)
                      : "—"}
                  </td>
                  <td className="mono px-2 py-2 text-right">
                    {r.engagement_rate !== null
                      ? `${(r.engagement_rate * 100).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-text-muted truncate max-w-[220px]">
                    {r.primary_categories.length > 0
                      ? r.primary_categories.join(", ")
                      : "—"}
                  </td>
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

/**
 * Compact number: 12345 → 12.3K, 1_500_000 → 1.5M. Matches how creator
 * follower counts read at a glance without pulling in a formatting lib.
 */
function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}
