import type {
  WebhookLine,
  WebhookPayload,
} from "@/lib/domain/webhook-schema";

/**
 * Payload factories for the marketplace simulator.
 *
 * These produce values shaped like real TikTok Shop webhook deliveries, so
 * the demo exercises the real ingestion path (ADR-008). The seed SKUs match
 * `channel_listings` from migration 002; anything not in this list will
 * fail SKU resolution and land in the DLQ — which is exactly what the
 * "unknown SKU" chaos button demonstrates.
 */

export const TIKTOK_SEED_SKUS = [
  "TTS-VC-BT-100",
  "TTS-VC-ANC-200",
  "TTS-VC-PTY-50",
  "TTS-VC-MIC-10",
  "TTS-PB-PRO-750",
  "TTS-PB-GO-300",
  "TTS-PB-JAR-64",
  "TTS-PB-TAMP-1",
  "TTS-LM-AIR-2",
  "TTS-LM-LAMP-S",
  "TTS-LM-HUM-1",
  "TTS-LM-DIFF-A",
] as const;

const PRICE_MENU_CENTS = [1299, 2999, 3999, 5999, 7999, 8999, 12999, 14999, 19999, 24999];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function newEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

function newExternalOrderId(): string {
  return `TTS-${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

export interface OrderCreatedOverrides {
  event_id?: string;
  external_order_id?: string;
  buyer_handle?: string;
  placed_at?: string;
  lines?: WebhookLine[];
}

export function orderCreated(overrides: OrderCreatedOverrides = {}): WebhookPayload {
  const now = new Date().toISOString();
  return {
    event_id: overrides.event_id ?? newEventId(),
    event_type: "order.created",
    occurred_at: now,
    order: {
      external_order_id: overrides.external_order_id ?? newExternalOrderId(),
      buyer_handle:
        overrides.buyer_handle ??
        `@buyer_${Math.floor(Math.random() * 10_000)}`,
      placed_at: overrides.placed_at ?? now,
      lines: overrides.lines ?? [
        {
          external_sku: pick(TIKTOK_SEED_SKUS),
          qty: Math.floor(Math.random() * 3) + 1,
          unit_price_cents: pick(PRICE_MENU_CENTS),
        },
      ],
    },
  };
}

export function orderCancelled(externalOrderId: string): WebhookPayload {
  const now = new Date().toISOString();
  return {
    event_id: newEventId(),
    event_type: "order.cancelled",
    occurred_at: now,
    order: {
      external_order_id: externalOrderId,
      placed_at: now,
      // cancel payloads still carry the original lines for auditability;
      // they're not re-processed by _apply_order_cancelled.
      lines: [
        {
          external_sku: pick(TIKTOK_SEED_SKUS),
          qty: 1,
          unit_price_cents: 0,
        },
      ],
    },
  };
}

/**
 * Ship notification. The RPC (`_apply_order_shipped`) doesn't consult the
 * payload's lines — it iterates `order_lines` by order_id — so the lines
 * here are schema-compliance placeholders.
 */
export function orderShipped(externalOrderId: string): WebhookPayload {
  const now = new Date().toISOString();
  return {
    event_id: newEventId(),
    event_type: "order.shipped",
    occurred_at: now,
    order: {
      external_order_id: externalOrderId,
      placed_at: now,
      lines: [
        {
          external_sku: pick(TIKTOK_SEED_SKUS),
          qty: 1,
          unit_price_cents: 0,
        },
      ],
    },
  };
}

/**
 * Return notification. Same shape as `orderShipped` — the RPC iterates
 * order_lines by id, not by payload.
 */
export function orderReturned(externalOrderId: string): WebhookPayload {
  const now = new Date().toISOString();
  return {
    event_id: newEventId(),
    event_type: "order.returned",
    occurred_at: now,
    order: {
      external_order_id: externalOrderId,
      placed_at: now,
      lines: [
        {
          external_sku: pick(TIKTOK_SEED_SKUS),
          qty: 1,
          unit_price_cents: 0,
        },
      ],
    },
  };
}

/** Order whose SKU is not in `channel_listings` — DLQ scenario. */
export function unknownSkuOrder(): WebhookPayload {
  return orderCreated({
    lines: [
      {
        external_sku: "TTS-DOES-NOT-EXIST",
        qty: 1,
        unit_price_cents: 999,
      },
    ],
  });
}

/**
 * Order that asks for more stock than we ever seeded — CHECK firewall
 * refuses via `allocate_order`, function returns `backordered`.
 */
export function overshootOrder(): WebhookPayload {
  return orderCreated({
    lines: [
      {
        external_sku: "TTS-VC-BT-100",
        qty: 99_999,
        unit_price_cents: 7999,
      },
    ],
  });
}

// ============================================================================
// ESI/ERP webhook payload factories (ADR-011, migration 013)
// ============================================================================

interface EsiCountArgs {
  sku?: string;
  location?: string;
  countedQty?: number;
}

export function esiCount(args: EsiCountArgs = {}): {
  event_id: string;
  event_type: "stock.counted";
  emitted_at: string;
  stock: { external_sku: string; location: string; counted_qty: number };
} {
  return {
    event_id: `ESI-CNT-${crypto.randomUUID()}`,
    event_type: "stock.counted",
    emitted_at: new Date().toISOString(),
    stock: {
      external_sku: args.sku ?? "VC-BT-100",
      location: args.location ?? "Van Nuys DC",
      counted_qty: args.countedQty ?? 115,
    },
  };
}

interface EsiTransferArgs {
  sku?: string;
  fromLocation?: string;
  toLocation?: string;
  qty?: number;
}

export function esiTransfer(args: EsiTransferArgs = {}): {
  event_id: string;
  event_type: "stock.transferred";
  emitted_at: string;
  transfer: {
    external_sku: string;
    from_location: string;
    to_location: string;
    qty: number;
  };
} {
  return {
    event_id: `ESI-TR-${crypto.randomUUID()}`,
    event_type: "stock.transferred",
    emitted_at: new Date().toISOString(),
    transfer: {
      external_sku: args.sku ?? "VC-BT-100",
      from_location: args.fromLocation ?? "Van Nuys DC",
      to_location: args.toLocation ?? "Reno DC",
      qty: args.qty ?? 25,
    },
  };
}

interface EsiDamageArgs {
  sku?: string;
  location?: string;
  qty?: number;
  note?: string;
}

export function esiDamage(args: EsiDamageArgs = {}): {
  event_id: string;
  event_type: "stock.damaged";
  emitted_at: string;
  damage: {
    external_sku: string;
    location: string;
    qty: number;
    note?: string;
  };
} {
  return {
    event_id: `ESI-DMG-${crypto.randomUUID()}`,
    event_type: "stock.damaged",
    emitted_at: new Date().toISOString(),
    damage: {
      external_sku: args.sku ?? "VC-BT-100",
      location: args.location ?? "Van Nuys DC",
      qty: args.qty ?? 3,
      note: args.note ?? "water damage during handling",
    },
  };
}

/**
 * A burst of independent orders. Used to demonstrate the ledger and rollup
 * still agree after concurrent-ish traffic (Day 3 dashboard shows the tick).
 */
export function burst(count: number): WebhookPayload[] {
  return Array.from({ length: count }, () => orderCreated());
}

/** Structurally invalid payload — missing event_id + event_type. */
export function malformedMissingRequiredFields(): unknown {
  return {
    occurred_at: new Date().toISOString(),
    order: { external_order_id: newExternalOrderId() },
  };
}

/** Duplicate: reuse an existing payload verbatim so the event_id repeats. */
export function duplicate(previous: WebhookPayload): WebhookPayload {
  return previous;
}
