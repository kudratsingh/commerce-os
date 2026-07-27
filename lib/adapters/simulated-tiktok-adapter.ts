import type { Db } from "@/lib/db/server";

import {
  AdapterRetryableError,
  type MarketplaceAdapter,
} from "./marketplace-adapter";

/**
 * SimulatedTikTokAdapter — a stateful fake, not a stub (ADR-010).
 *
 * `updateInventory` writes a fresh row to `channel_inventory_reports`, which
 * is the same table `run_reconciliation` reads to know "what the marketplace
 * currently believes." So the fake IS the marketplace's belief; there is no
 * shadow state. Skew it via `skew_channel_report` (the chaos simulator) →
 * it believes wrong; call updateInventory → it believes right again, and
 * the next reconciliation run sees zero drift.
 *
 * Hostility: `simulator_config.hostile_rate` is a number in [0, 1]. On every
 * call, we roll and — if we lose — throw AdapterRetryableError. The sweeper
 * treats that as `outbox_mark_failed`, which schedules exponential backoff
 * with a DLQ after `max_attempts`. Set hostile_rate=0.3 live on stage,
 * fire a burst, watch the retry curve. Set it back to 0 and every row
 * lands on the first attempt.
 *
 * All the interesting machinery — the port, the retry, the DLQ, the outbox
 * emission on stock change, the reconciliation backstop — is REAL. The only
 * simulated piece is the wire.
 */
export class SimulatedTikTokAdapter implements MarketplaceAdapter {
  readonly channelId = "tiktok_shop";

  constructor(private readonly db: Db) {}

  async updateInventory(input: {
    productId: string;
    correctQty: number;
  }): Promise<{ acceptedAt: string }> {
    const hostileRate = await this.hostileRate();

    if (hostileRate > 0 && Math.random() < hostileRate) {
      throw new AdapterRetryableError(
        `simulated tiktok 429 (hostile_rate=${hostileRate})`,
      );
    }

    // The write. This IS the marketplace-side update — channel_inventory_reports
    // is the fake's belief, and reconciliation reads its most-recent row.
    const { error } = await this.db.from("channel_inventory_reports").insert({
      channel_id: this.channelId,
      product_id: input.productId,
      reported_qty: input.correctQty,
    });
    if (error) {
      // Insert failures are our bug, not the marketplace's — surface as
      // permanent (non-retryable) so we don't burn a backoff cycle on it.
      throw new Error(`simulated tiktok write failed: ${error.message}`);
    }

    return { acceptedAt: new Date().toISOString() };
  }

  private async hostileRate(): Promise<number> {
    const { data, error } = await this.db.rpc("get_simulator_config", {
      p_key: "hostile_rate",
    });
    if (error) {
      // If we can't read the toggle, act non-hostile — better to demo
      // false-negatives than to accidentally soak the test in retries.
      return 0;
    }
    const n = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }
}
