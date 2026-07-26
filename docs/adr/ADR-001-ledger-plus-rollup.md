# ADR-001: Append-only ledger + constrained rollup for inventory

**Status:** Accepted · **Date:** Day 0

## Context
Platinum's inventory and order ledger is maintained manually today. The system
of record must offer (a) a trustworthy audit trail ("why is on_hand 37?"),
(b) fast reads for dashboards, and (c) hard prevention of overselling one
unit across multiple marketplaces.

## Decision
Two structures with a proven relationship:
- `stock_movements`: append-only journal of physical unit movements, immutability
  enforced by a trigger. This is the source of truth.
- `stock_levels`: rollup per product/location (`on_hand`, `committed`) maintained
  only by domain functions, with `CHECK (committed <= on_hand)` as an
  un-bypassable oversell firewall.
- `run_reconciliation()` proves rollup == SUM(journal) and flags drift.

Reservations (allocate/cancel) touch only `committed`; physical events
(receive/ship) write the journal and move `on_hand`.

## Alternatives rejected
- **Mutable counter only** (what a spreadsheet is): fast, zero audit trail,
  silent drift, no defense in depth.
- **Full event sourcing with replay**: correct but heavy — projections,
  versioned events, replay infrastructure. Wrong cost for team size; the
  journal gives 80% of the benefit at 20% of the machinery.

## Consequences
Corrections are new `adjustment` movements, never edits. Journal grows
unboundedly → partition by month at ~10M rows. Every number on the dashboard
is derivable and auditable.
