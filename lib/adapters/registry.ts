import type { Db } from "@/lib/db/server";

import type { MarketplaceAdapter } from "./marketplace-adapter";
import { SimulatedTikTokAdapter } from "./simulated-tiktok-adapter";

/**
 * Channel → adapter binding (ADR-010). Today: TikTok Shop → simulated fake.
 * Module 6.a replaces the entry with `LiveTikTokAdapter` and swap-in is
 * a one-line change here; the sweeper, the outbox contract, and every
 * upstream domain call stay identical.
 */
export function getMarketplaceAdapter(
  db: Db,
  channelId: string,
): MarketplaceAdapter | null {
  switch (channelId) {
    case "tiktok_shop":
      return new SimulatedTikTokAdapter(db);
    default:
      // Unknown channel = no adapter bound yet. The sweeper treats this
      // as a permanent failure and dead-letters the row; matches how a
      // real system would flag "we emitted for a channel we haven't
      // integrated with."
      return null;
  }
}
