# ADR-012: Append-only touchpoints + derived creator status

**Status:** Accepted
**Date:** 2026-07-27
**Extends:** ADR-001 (append-only ledger)

## Context

Module 4 turns a 20,000-creator network run on spreadsheets into a CRM.
Every seasoned CRM has the same failure mode: fields get overwritten. A
manager marks a creator "declined" during a bad week; six months later
nobody remembers what the last state was, and the outreach team runs the
same cold-email sequence again. The audit trail — who said no, when, on
which offer — vanishes.

Meanwhile, this codebase already has a proven pattern for "audit trail
is a story you read, not a state you edit": `stock_movements` (ADR-001).
Every movement is a fact, timestamped, never mutated. Corrections are
new movements with notes. A ledger row six months old still tells the
truth about what happened that day.

The Creator CRM should adopt the same shape.

## Decision

`creator_touchpoints` is APPEND-ONLY and `creators.status` is DERIVED.

1. **Every interaction is a row.** Outreach sent, reply received, call
   held, meeting scheduled, contract signed, payment issued — each is a
   `creator_touchpoints` row. `kind` names the shape, `direction` names
   the initiator (outbound=us, inbound=them), `occurred_at` is when it
   happened in the real world (not when the row was created).

2. **The row is immutable.** A `BEFORE UPDATE OR DELETE` trigger raises
   an exception. Mirrors the `stock_movements` guarantee. To correct a
   past touchpoint, the app writes a new touchpoint with a note ("prior
   record incorrect: reply was actually on Tue, not Wed"). History
   accumulates rather than erasing.

3. **`creators.status` is derived, not free-form.** The domain function
   `register_touchpoint()` is the ONLY writer to this column. It applies
   a fixed transition table based on the incoming touchpoint kind:
   - `outreach` (outbound), first time → `contacted`, set `first_contacted_at`
   - `reply` (inbound), from `contacted` → `replied`
   - `contract` from any pre-accepted status → `accepted`
   - `payment` from any → `active`, set `became_active_at`
   Terminal states (`declined`, `blocked`) are set by ops UI paths, not
   from touchpoints — because they're a decision, not an event.

4. **The CRM is thus reconstructable from the ledger alone.** If
   `creators.status` were corrupted (bad migration, ops accident), a
   single SQL replay of `register_touchpoint` per historical touchpoint
   restores the state. Same guarantee `stock_movements` gives us for
   `stock_levels`.

## The pivot: `ship_sample()`

Sample requests are where the CRM meets the ledger. `ship_sample()`
does three things in one transaction:
- writes a `stock_movements` row (`reason='sample_sent'`, `qty_delta=-N`),
- updates `stock_levels.on_hand` to match,
- writes a `sample_ship` touchpoint on the creator so their CRM
  timeline shows the shipment.

The physical inventory drop and the CRM interaction are the same event.
Recording both from one call is what turns "sample center shrinkage" (a
recurring line item in every commerce ops meeting) into a solved problem:
samples ARE stock, tracked the same way orders are.

`sample_requests.stock_movement_id` links back to the ledger row for
traceability — an auditor can walk from a stock_movements row to the
sample request to the creator to the touchpoint that recorded the ship.

## Consequences

- Creators.status is safe to trust in views + dashboards; the derivation
  rule is one place to read (in `register_touchpoint`), not scattered
  across the app.
- Correcting a mis-classified touchpoint is a UI feature, not a data
  migration. The correcting touchpoint carries the story.
- Reporting is easy: any funnel query is a group-by over
  `creator_touchpoints.kind`. Retention/response/acceptance rates fall
  out of a windowed SQL count.
- Storage grows monotonically. This is the same trade-off as
  stock_movements and has the same answer: a partitioning strategy when
  we cross ~50M rows. For 20K creators × ~50 touchpoints each ~= 1M
  rows, we're a long way from that concern.

## Alternatives rejected

- **Mutable `status` field.** The default CRM shape. Wins on write
  ergonomics, loses the audit story we just spent Module 1 building.
- **Status column + separate touchpoints table but hand-updated status.**
  Two writers, guaranteed to disagree. Same failure mode as the
  ledger/rollup drift the reconciliation job exists to catch — solvable
  but expensive, versus just deriving.
- **Event sourcing framework.** Overkill for a 6-kind transition table.
  Postgres + a plpgsql function is enough.

## Related

- [ADR-001](./ADR-001-append-only-ledger.md) — the ledger this pattern
  mirrors. `stock_movements` is to `stock_levels` what
  `creator_touchpoints` is to `creators.status`.
- Migration 015 — the schema landing this decision.
