import type { Db } from "@/lib/db/server";

/**
 * MarketplaceAdapter — the outbound port (ADR-010).
 *
 * Every marketplace we integrate with implements this interface. Domain code
 * emits outbox rows describing WHAT to push; the sweeper calls the adapter
 * to actually PUSH. The interface is deliberately small: today only
 * `updateInventory`, so we can prove the loop; future modules add
 * `acknowledgeOrder`, `pushListing`, `pushTracking` behind the same shape.
 *
 * The operation semantic worth being precise about: marketplaces do not have
 * a "you're wrong, please fix" endpoint. TikTok Shop (and every peer) treats
 * the listing quantity as a CACHE of what the seller last declared sellable.
 * As seller of record we OWN that field on their side. So `updateInventory`
 * is a WRITE — an overwrite of the marketplace's listing qty with the current
 * `available_to_sell`. Not a report, not a delta, not a message they might
 * consider. Just a write.
 *
 * Sync-on-change writes the true available continuously (trigger on
 * stock_levels). Reconciliation-push is the backstop: it writes the same
 * value again if we caught drift, which by construction only happens when a
 * sync-on-change delivery got dropped.
 *
 * The current bind (dev + demo) is `SimulatedTikTokAdapter` — a stateful
 * fake, not a stub. See `lib/adapters/simulated-tiktok-adapter.ts`. Swapping
 * to a live implementation is a registry change, not a domain change.
 */
export interface MarketplaceAdapter {
  readonly channelId: string;

  /**
   * Overwrite the marketplace's cached listing quantity for a product.
   * Throws `AdapterRetryableError` for 429/5xx-shape failures (the sweeper
   * will call outbox_mark_failed → exponential backoff → eventual DLQ).
   * Throws a plain Error for permanent failures — those go dead immediately
   * via the same handler; we don't distinguish yet, and the outbox retry
   * policy is honest either way.
   */
  updateInventory(input: {
    productId: string;
    correctQty: number;
  }): Promise<{ acceptedAt: string }>;
}

export class AdapterRetryableError extends Error {
  readonly retryable = true as const;
  constructor(message: string) {
    super(message);
    this.name = "AdapterRetryableError";
  }
}

/**
 * Small factory type — a registry maps `channel_id` → adapter instance,
 * receiving the server DB handle so a stateful adapter (like the fake)
 * can persist its belief. Live adapters ignore the handle.
 */
export type MarketplaceAdapterFactory = (db: Db) => MarketplaceAdapter;
