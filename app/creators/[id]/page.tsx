import Link from "next/link";
import { notFound } from "next/navigation";

import { CreatorStatusPill } from "@/components/creators/CreatorStatusPill";
import { TouchpointForm } from "@/components/creators/TouchpointForm";
import { TouchpointTimeline } from "@/components/creators/TouchpointTimeline";
import { createSupabaseServer } from "@/lib/db/server";
import {
  getCreatorById,
  getCreatorTouchpoints,
  getSampleRequests,
} from "@/lib/queries/creators";
import { relativeTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /creators/[id] — profile view.
 *
 * Three panels stacked:
 *   1. Header (handle, status pill, platform, headline stats)
 *   2. TouchpointForm — logs a new interaction; the RPC decides the
 *      status transition and the router.refresh cascades everything
 *      below.
 *   3. TouchpointTimeline — every past interaction, most recent first.
 *   4. Recent samples — samples shipped/requested for this creator.
 */
export default async function CreatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createSupabaseServer();

  const [creator, touchpoints, samples] = await Promise.all([
    getCreatorById(db, id),
    getCreatorTouchpoints(db, id, 200),
    getSampleRequests(db, { creatorId: id, limit: 20 }),
  ]);

  if (!creator) notFound();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-5 space-y-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        <Link href="/creators" className="hover:underline">
          Creators
        </Link>
        <span className="mx-1">/</span>
        <span className="mono">{creator.handle}</span>
      </div>

      <div className="rounded-md border border-border bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="mono text-lg font-semibold">{creator.handle}</h1>
              <span className="text-[11px] uppercase tracking-[0.14em] text-text-faint">
                {creator.platform}
              </span>
              <CreatorStatusPill status={creator.status} />
            </div>
            {creator.display_name && (
              <div className="text-sm text-text-muted mt-0.5">
                {creator.display_name}
              </div>
            )}
            <div className="mt-1 text-[11px] text-text-muted">
              added {relativeTime(creator.created_at)}
              {creator.first_contacted_at
                ? ` · first contacted ${relativeTime(creator.first_contacted_at)}`
                : ""}
              {creator.became_active_at
                ? ` · active since ${relativeTime(creator.became_active_at)}`
                : ""}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Followers"
              value={
                creator.follower_count !== null
                  ? formatCompact(creator.follower_count)
                  : "—"
              }
            />
            <Stat
              label="Engagement"
              value={
                creator.engagement_rate !== null
                  ? `${(creator.engagement_rate * 100).toFixed(2)}%`
                  : "—"
              }
            />
            <Stat
              label="Touchpoints"
              value={String(touchpoints.length)}
            />
          </div>
        </div>
        {creator.primary_categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {creator.primary_categories.map((c) => (
              <span
                key={c}
                className="mono text-[10px] uppercase tracking-wider text-text-muted border border-border rounded px-2 py-0.5"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-text-muted">
          {creator.contact_email && (
            <span className="mono">{creator.contact_email}</span>
          )}
          {creator.contact_phone && (
            <span className="mono">{creator.contact_phone}</span>
          )}
          {creator.base_country && (
            <span className="mono uppercase">{creator.base_country}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <TouchpointForm creatorId={creator.id} />
          <TouchpointTimeline rows={touchpoints} />
        </div>
        <RecentSamples samples={samples} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className="mono mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

function RecentSamples({
  samples,
}: {
  samples: Awaited<ReturnType<typeof getSampleRequests>>;
}) {
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Recent samples</div>
        <div className="text-[11px] text-text-muted">
          Shipped via <span className="mono">ship_sample()</span> — the ledger
          gets a <span className="mono">sample_sent</span> row for each.
        </div>
      </div>
      {samples.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          No samples yet.
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {samples.map((s) => (
            <li key={s.id} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="mono text-xs">{s.product_sku ?? "—"}</div>
                <span
                  className={`mono text-[10px] uppercase tracking-wider ${
                    s.status === "shipped" || s.status === "delivered"
                      ? "text-accent"
                      : s.status === "declined"
                        ? "text-danger"
                        : "text-info"
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="text-[11px] text-text-muted truncate">
                {s.product_title ?? "—"} · qty {s.qty}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-faint">
                <span>{relativeTime(s.requested_at)}</span>
                {s.tracking_number && (
                  <span className="mono">· {s.tracking_number}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}
