-- ============================================================================
-- COMMERCE OS — Test-state reset helper (Migration 014)
--
-- Integration tests share a single local Supabase instance; cross-file writes
-- from earlier suites shift the numbers later suites read against. Notably,
-- ADR-010's sync-on-change trigger emits `inventory.sync` outbox rows on
-- every stock movement, which the sweeper dispatches through the adapter →
-- `channel_inventory_reports` gets updated during earlier tests, so later
-- tests find stale reports where they expected none.
--
-- This migration adds two categories of artifact used ONLY by the test suite:
--
--   • `_test_baseline_*` snapshot tables — captured at migration time from
--     whatever the seed left in the source table. There's one per table
--     whose seed rows a test file depends on (stock levels, ledger, POs,
--     receipts, channel reports).
--
--   • `reset_test_state()` — truncates every table that a test can add to,
--     then restores the seed baseline from the snapshots. Idempotent and
--     ~100ms — far cheaper than `supabase db reset --local` per test file.
--
-- Production code MUST NOT call `reset_test_state()`. Nothing in the app
-- references it. The leading-underscore convention on baseline tables and
-- the "test_" name make the scope obvious to reviewers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Baseline snapshot tables — one per seed-populated table
-- ----------------------------------------------------------------------------

create table _test_baseline_stock_levels as
  select * from stock_levels;
alter table _test_baseline_stock_levels
  add primary key (product_id, location_id);

create table _test_baseline_stock_movements as
  select * from stock_movements;

create table _test_baseline_purchase_orders as
  select * from purchase_orders;

create table _test_baseline_purchase_order_lines as
  select * from purchase_order_lines;

create table _test_baseline_receipts as
  select * from receipts;

create table _test_baseline_channel_inventory_reports as
  select * from channel_inventory_reports;

comment on table _test_baseline_stock_levels is
  'Test-only baseline snapshot. Do not read/write from app code.';

-- ----------------------------------------------------------------------------
-- 2. reset_test_state()
--
-- Called from tests/helpers/reset-ephemera.ts at the start of each integration
-- test file. Wipes the ephemeral tables clean and restores every seeded table
-- from its snapshot, giving each file the exact state `supabase db reset`
-- would produce.
--
-- TRUNCATE bypasses the `forbid_ledger_mutation` BEFORE UPDATE OR DELETE
-- trigger on `stock_movements` — invariant #1 stands. That guarantee is
-- against row-level history rewrites, which TRUNCATE isn't; it's a
-- schema-level op that swaps the whole heap for an empty one.
--
-- Truncation happens with CASCADE so the FK web between orders/order_lines,
-- purchase_orders/purchase_order_lines, receipts/landed_costs/margin_snapshots
-- is handled in one pass.
-- ----------------------------------------------------------------------------

create or replace function reset_test_state() returns void
language plpgsql as $$
begin
  -- Short lock_timeout so a residual PostgREST connection holding a shared
  -- lock surfaces quickly (the caller retries with backoff) instead of
  -- hanging the whole suite on a deadlock.
  set local lock_timeout to '2s';

  -- TRUNCATE bypasses the BEFORE DELETE trigger on stock_movements
  -- (invariant #1 protects against ROW-LEVEL history rewrites; TRUNCATE is
  -- a schema-level heap swap and isn't a row DELETE). CASCADE handles the
  -- FK web (receipts ← landed_costs, orders ← margin_snapshots, etc.) in
  -- one pass.
  truncate table
    margin_snapshots,
    landed_costs,
    receipts,
    purchase_order_lines,
    purchase_orders,
    erp_inventory_reports,
    channel_inventory_reports,
    reconciliation_findings,
    reconciliation_runs,
    outbox,
    webhook_events,
    order_lines,
    orders,
    stock_movements
  cascade;

  -- Restore stock_levels: on_hand from baseline, committed=0.
  update stock_levels sl
     set on_hand   = b.on_hand,
         committed = 0
    from _test_baseline_stock_levels b
   where sl.product_id = b.product_id
     and sl.location_id = b.location_id;

  -- Restore seeded ledger + PO + receipts + reports (order matters for FKs).
  -- OVERRIDING SYSTEM VALUE lets us preserve the identity-column IDs from
  -- the snapshot, so any cross-reference (e.g. reconciliation_findings.id
  -- from a previous run) matches what a fresh `supabase db reset` would
  -- produce.
  insert into stock_movements overriding system value
    select * from _test_baseline_stock_movements;
  insert into purchase_orders overriding system value
    select * from _test_baseline_purchase_orders;
  insert into purchase_order_lines overriding system value
    select * from _test_baseline_purchase_order_lines;
  insert into receipts overriding system value
    select * from _test_baseline_receipts;
  insert into channel_inventory_reports overriding system value
    select * from _test_baseline_channel_inventory_reports;

  -- Neutralize simulator_config so a test that raised hostile_rate doesn't
  -- poison the next file.
  update simulator_config
     set value = to_jsonb(0::numeric)
   where key = 'hostile_rate';
end $$;

comment on function reset_test_state() is
  'Test-only: truncate ephemeral tables and restore seed baseline. '
  'NEVER call from production code.';

grant execute on function reset_test_state() to service_role;
