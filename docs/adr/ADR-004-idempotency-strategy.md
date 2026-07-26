# ADR-004: Two-level idempotency; duplicates get 200

**Status:** Accepted · **Date:** Day 0

## Context
Marketplace webhooks are at-least-once: duplicates, retries, and out-of-order
deliveries are normal operation, not edge cases. A duplicate that
double-allocates stock is a customer-facing incident.

## Decision
Defense at two levels, both database constraints:
1. **Event level:** `webhook_events UNIQUE (channel_id, external_event_id)`,
   inserted with `ON CONFLICT DO NOTHING`. No row inserted → duplicate → stop.
2. **Order level:** `orders UNIQUE (channel_id, external_order_id)` — even a
   duplicate under a fresh event id cannot create or allocate the order twice.

Duplicates return **200** `{deduped:true}`, not 409: a non-2xx tells the
marketplace to keep retrying forever. From their perspective the delivery
succeeded; that we'd seen it already is our business.

Processing steps are individually idempotent so a `failed` event can be
retried safely from any point.

## Consequences
`webhook_events` doubles as the audit log and the DLQ (status: received /
processed / failed / dead). Unknown-SKU and malformed payloads become visible
operational queues instead of silent drops.
