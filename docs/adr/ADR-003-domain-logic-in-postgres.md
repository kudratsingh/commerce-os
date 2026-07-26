# ADR-003: Domain mutations live in Postgres functions

**Status:** Accepted · **Date:** Day 0

## Context
Allocation, shipment, receiving, and cancellation each mutate multiple rows
under invariants (no oversell, ledger/rollup consistency). App-layer
transactions can express this, but every new code path (script, contractor,
bug) is a chance to skip the rules.

## Decision
`receive_po_line`, `allocate_order`, `ship_order`, `cancel_order`,
`run_reconciliation` are plpgsql functions called via RPC. TypeScript
orchestrates; SQL decides. Row locks (`FOR UPDATE`, stable lock ordering) and
the all-or-nothing exception-block pattern live next to the data.

## Alternatives rejected
- **App-layer transactions in TypeScript:** portable, but invariants become
  conventions. The CHECK constraint plus in-DB functions make violations a
  database error rather than a code-review hope.
- **ORM unit-of-work:** hides locking exactly where locking is the point.

## Consequences
Testable directly in SQL (`db/tests/invariants.sql`) and from Vitest via RPC.
plpgsql is less familiar to some hires → functions kept short, commented, and
walked in `docs/architecture.md`. Migrations are the deploy path for logic
changes — versioned like everything else.
