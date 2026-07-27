# ADR-011: ESI/ERP mastership + append-only corrections

**Status:** Accepted
**Date:** 2026-07-27
**Extends:** ADR-008 (simulator over live API), ADR-010 (ports & adapters)

## Context

Commerce OS sits between two peer systems: an ERP called ESI (physical
inventory, receiving dock, cycle counts, physical transfers) and multiple
marketplaces (TikTok Shop first, Amazon/Walmart later). Both systems care
about inventory, but neither can compute the number that matters most to
marketplaces: **available-to-sell**.

Nobody but the middle tier holds both halves:

- **ESI** is authoritative on physical count (`on_hand`). It's where
  receiving happens, where cycle counts run, where damage is written off.
- **We** are authoritative on reservations (`committed`). Marketplace
  orders flow through our ingestion; ESI has no visibility into an
  allocation until a fulfillment request reaches its dock.
- **Available = on_hand − committed**. Only computable here.

That's the whole reason this system exists as its own tier. It does not
attempt to master physical truth (that's ESI's job) and it does not push
orders through to fulfillment (that's a downstream story). It reconciles
upward as a **consumer** of ESI and downward as a **master** of
`available` — feeding marketplaces the number they need.

## Decision

Adopt an explicit **mastership-by-column** model, with corrections
recorded as **new facts in the append-only ledger** rather than edits to
history:

1. **Inbound ESI events use the same webhook rails as marketplace
   events.** `/api/webhooks/erp` mirrors `/api/webhooks/tiktok`: HMAC,
   dedupe on `(channel, external_event_id)`, zod validation, DLQ + retry
   via `webhook_events`. Nothing about the ingestion pipeline is
   marketplace-specific; the source-agnostic contract was ADR-004's whole
   point, and this extends it to ESI without a new architecture.

2. **Three new event types cover the ESI vocabulary:**
   - `stock.counted` — cycle count. Appends an `adjustment` movement
     equal to `counted_qty − current_on_hand`, updates the rollup.
   - `stock.transferred` — paired `transfer_out` (source) +
     `transfer_in` (destination) in one transaction. If the source
     drop would violate `CHECK (committed <= on_hand)`, the whole
     transfer rolls back.
   - `stock.damaged` — negative `damage` movement, no receipt.

3. **`reconciliation_findings.kind` gains `erp_drift`.** Third loop in
   `run_reconciliation` compares `erp_inventory_reports.reported_qty`
   (ESI's belief) to `stock_levels.on_hand` (ours), with **authority
   inverted**: ESI's number goes in `expected`, ours in `actual`.
   Because ESI is master of on_hand, disagreement means we're wrong
   about physical truth — not the other way around.

4. **Resolution can now APPLY the correction, not just flip a flag.**
   `resolve_reconciliation_finding` takes a `p_strategy`:
   - `'ack'` — preserves the previous behavior. Status flips to
     `resolved`, no ledger side-effect. Use when the operator is still
     investigating.
   - `'accept_source'` — for `erp_drift`, appends an `adjustment`
     movement with `qty_delta = ESI.on_hand − our.on_hand`, updates the
     rollup, THEN flips status. The correction shows up in the ledger as
     "on {timestamp}, accepted ESI count (finding N, delta ±M)". Six
     months later, an auditor reads the ledger and sees exactly when and
     why we deferred to ESI. That's the append-only elegance: we don't
     rewrite history to match ESI, we append the deferral **as a fact**.

## The overwrite semantic, re-applied

ADR-010 named this for marketplaces: the outbound operation is a WRITE,
not a report. Here the inbound operation is the same shape from the
other side. ESI doesn't ask us if it's right about `on_hand` — it just
sends us its number. As consumer we either accept (via `accept_source`)
or we investigate (via `ack`). Never negotiate.

## Consequences

- The ledger keeps every mastership handoff as a first-class fact.
  Auditability is a byproduct of append-only, not a feature bolted on.
- `receive_po_line` is no longer the ONLY normal path by which `on_hand`
  increases — ESI-driven adjustments and transfers join it as peer
  event types. The comment on `stock_levels.on_hand` (and the
  demo-script narration about receipts) needs to reflect that under
  ESI-master mode the receive path is one of several inbound writers.
- Sync-on-change still fires. A cycle count at ESI that lowers on_hand
  triggers our trigger, which emits `inventory.sync` to marketplaces
  automatically — the same self-healing loop from ADR-010, now covering
  ESI-originated changes without any extra code.
- The `available_to_sell` view is untouched. The subtractive definition
  (`on_hand − committed`) doesn't care who last wrote to either column.

## Alternatives rejected

- **Two-way ownership of on_hand.** Would require conflict resolution,
  operator escalation on every mismatch. Column-level mastership is
  cheaper and matches how ESI actually works.
- **Editing the ledger on ESI acceptance.** Would violate invariant #1
  (`stock_movements` is APPEND-ONLY) for no benefit. The delta is
  perfectly represented by a new adjustment row.
- **Rejecting ESI events that disagree with our current on_hand.**
  Backwards: ESI is master. If we disagree with ESI, WE are wrong.

## Deliberate follow-ups

- **Buffer + target-listed qty for marketplaces.** ADR-010 called this
  out as a follow-up; still relevant. A cycle count that lowers on_hand
  should shrink the marketplace listing accordingly, but a seller who
  intentionally buffers below true available shouldn't push the raw
  number.
- **Two-way transfers as one event.** Today we insist ESI sends one
  `stock.transferred` payload per movement. If real ESI emits two
  paired events (dock-out + dock-in), we'd need to correlate them —
  parking until we see the real feed.

## Related

- [ADR-004](./ADR-004-source-agnostic-ingestion.md) — the dedupe /
  webhook contract this extends.
- [ADR-010](./ADR-010-ports-and-adapters.md) — the OUTBOUND direction
  of this same middle-tier compression.
- Migration 013 — the schema landing.
