"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowser } from "@/lib/db/browser";
import type { OrderRow } from "@/lib/queries/orders";
import { formatCents, relativeTime } from "@/lib/utils/format";

/**
 * Live order feed. Server rendered with the initial 40 orders, then a
 * postgres_changes subscription on `orders` pushes new rows in as they
 * land. New rows glow briefly (accent ring fades out) so a demo audience
 * sees them arrive.
 *
 * Note: the browser subscribes directly to Supabase (ADR-005) — the
 * Worker is not in this path.
 */
export function LiveOrderFeed({ initial }: { initial: OrderRow[] }) {
  const [rows, setRows] = useState<OrderRow[]>(initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const client = createSupabaseBrowser();
    const channel = client
      .channel("orders-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        async (payload) => {
          const raw = payload.new as Record<string, unknown>;
          // The realtime payload doesn't include the joined brand_name, so
          // fill an "…" placeholder and let the next SSR paint fix it.
          const row: OrderRow = {
            id: String(raw.id ?? ""),
            channel_id: String(raw.channel_id ?? ""),
            external_order_id: String(raw.external_order_id ?? ""),
            status: (raw.status as OrderRow["status"]) ?? "received",
            buyer_handle: (raw.buyer_handle as string | null) ?? null,
            subtotal_cents: Number(raw.subtotal_cents ?? 0),
            placed_at: String(raw.placed_at ?? new Date().toISOString()),
            created_at: String(raw.created_at ?? new Date().toISOString()),
            brand_id: String(raw.brand_id ?? ""),
            brand_name: "…",
          };
          setRows((prev) => [row, ...prev].slice(0, 60));
        },
      )
      .subscribe();

    // Tick every 15s so relative timestamps ("3s ago") refresh without a
    // per-row timer.
    const t = setInterval(() => setTick((v) => v + 1), 15_000);

    return () => {
      clearInterval(t);
      void client.removeChannel(channel);
    };
  }, []);

  const now = new Date();
  void tick; // referenced so the effect re-renders

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Live order feed</div>
          <div className="text-[11px] text-text-muted">
            Push, not poll. Subscribed to `postgres_changes` on `orders`.
          </div>
        </div>
        <div className="text-[11px] text-text-muted">{rows.length} orders</div>
      </div>
      <div className="max-h-[420px] overflow-auto divide-y divide-border/60">
        {rows.length === 0 && (
          <div className="p-6 text-center text-sm text-text-muted">
            No orders yet. Fire one with{" "}
            <span className="mono text-text">pnpm sim:fire one</span>.
          </div>
        )}
        {rows.map((r, idx) => (
          <FeedRow key={r.id || `${r.external_order_id}-${idx}`} order={r} now={now} />
        ))}
      </div>
    </div>
  );
}

function FeedRow({ order, now }: { order: OrderRow; now: Date }) {
  const statusClass =
    order.status === "allocated"
      ? "text-accent"
      : order.status === "backordered"
        ? "text-warn"
        : order.status === "cancelled" || order.status === "refunded"
          ? "text-text-muted line-through"
          : order.status === "shipped" || order.status === "delivered"
            ? "text-info"
            : "text-text";

  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-panel-hover">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="mono text-xs">{order.external_order_id}</span>
          <span className={`mono text-[10px] uppercase tracking-wider ${statusClass}`}>
            {order.status}
          </span>
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {order.brand_name} · {order.buyer_handle ?? "buyer"} ·{" "}
          {relativeTime(order.placed_at, now)}
        </div>
      </div>
      <div className="mono text-sm font-semibold text-text">
        {formatCents(order.subtotal_cents)}
      </div>
    </div>
  );
}
