-- ============================================================================
-- COMMERCE OS — Invariant Tests
-- Run after 001 + 002. Every block prints PASS/FAIL. These six properties are
-- the "hardened" claim, executable. Port to Vitest on Day 1; keep this file
-- as the canonical spec of what the system guarantees.
-- ============================================================================

\set ON_ERROR_STOP off

-- Helpers: grab ids we'll need
select id as speaker_id from products where sku = 'VC-BT-100' \gset
select id as loc_id from locations where name = 'Van Nuys DC' \gset
select id as brand_volt from brands where name = 'Voltcore Audio' \gset

-- ----------------------------------------------------------------------------
-- TEST 1: happy-path allocation reserves stock
-- ----------------------------------------------------------------------------
insert into orders (brand_id, channel_id, external_order_id, subtotal_cents, placed_at)
values (:'brand_volt', 'tiktok_shop', 'TEST-ORD-1', 7999, now())
returning id as ord1 \gset
insert into order_lines (order_id, product_id, qty, unit_price_cents)
values (:'ord1', :'speaker_id', 2, 7999);

select allocate_order(:'ord1', :'loc_id') as t1_result \gset
select case when :'t1_result' = 'allocated'
            and (select committed from stock_levels
                 where product_id = :'speaker_id' and location_id = :'loc_id') = 2
       then 'TEST 1 PASS: allocation reserved 2 units'
       else 'TEST 1 FAIL' end as result;

-- ----------------------------------------------------------------------------
-- TEST 2: oversell is refused, and partial lines roll back (all-or-nothing)
-- Order asks for 1 speaker (in stock) + 9999 mics (not in stock).
-- Expected: backordered, and the speaker line's reservation is NOT held.
-- ----------------------------------------------------------------------------
select id as mic_id from products where sku = 'VC-MIC-10' \gset
select committed as before_committed from stock_levels
 where product_id = :'speaker_id' and location_id = :'loc_id' \gset

insert into orders (brand_id, channel_id, external_order_id, subtotal_cents, placed_at)
values (:'brand_volt', 'tiktok_shop', 'TEST-ORD-2', 0, now())
returning id as ord2 \gset
insert into order_lines (order_id, product_id, qty, unit_price_cents) values
  (:'ord2', :'speaker_id', 1, 7999),
  (:'ord2', :'mic_id', 9999, 5999);

select allocate_order(:'ord2', :'loc_id') as t2_result \gset
select case when :'t2_result' = 'backordered'
            and (select committed from stock_levels
                 where product_id = :'speaker_id' and location_id = :'loc_id') = :'before_committed'
       then 'TEST 2 PASS: oversell refused, partial reservation rolled back'
       else 'TEST 2 FAIL' end as result;

-- ----------------------------------------------------------------------------
-- TEST 3: the ledger is append-only (mutation raises)
-- ----------------------------------------------------------------------------
do $$
begin
  update stock_movements set qty_delta = 999 where id = 1;
  raise notice 'TEST 3 FAIL: update was allowed';
exception when others then
  raise notice 'TEST 3 PASS: ledger mutation blocked (%)', sqlerrm;
end $$;

do $$
begin
  delete from stock_movements where id = 1;
  raise notice 'TEST 3b FAIL: delete was allowed';
exception when others then
  raise notice 'TEST 3b PASS: ledger delete blocked';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 4: the CHECK firewall blocks oversell even from raw SQL
-- (a buggy code path that bypasses allocate_order still cannot violate it)
-- ----------------------------------------------------------------------------
do $$
begin
  update stock_levels set committed = on_hand + 1
   where product_id = (select id from products where sku = 'VC-BT-100');
  raise notice 'TEST 4 FAIL: constraint did not fire';
exception when check_violation then
  raise notice 'TEST 4 PASS: committed <= on_hand enforced at the database';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 5: shipping writes the ledger and rollup stays equal to ledger
-- ----------------------------------------------------------------------------
select ship_order(:'ord1', :'loc_id');

select case when sl.on_hand = l.on_hand_ledger
       then 'TEST 5 PASS: after shipping, rollup on_hand == SUM(ledger) = ' || sl.on_hand
       else 'TEST 5 FAIL: rollup ' || sl.on_hand || ' vs ledger ' || l.on_hand_ledger
       end as result
from stock_levels sl
join current_stock_from_ledger l
  on l.product_id = sl.product_id and l.location_id = sl.location_id
where sl.product_id = :'speaker_id' and sl.location_id = :'loc_id';

-- ----------------------------------------------------------------------------
-- TEST 6: reconciliation catches injected drift
-- Skew the marketplace's reported qty for the speaker by +7, run recon,
-- expect exactly one channel_drift finding with delta = +7.
-- ----------------------------------------------------------------------------
insert into channel_inventory_reports (channel_id, product_id, reported_qty)
select 'tiktok_shop', :'speaker_id',
       (select available from available_to_sell where product_id = :'speaker_id') + 7;

select run_reconciliation() as recon_run \gset

select case when count(*) = 1 and max(delta) = 7
       then 'TEST 6 PASS: reconciliation flagged the injected +7 channel drift'
       else 'TEST 6 FAIL (' || count(*) || ' findings)' end as result
from reconciliation_findings
where run_id = :'recon_run' and kind = 'channel_drift' and product_id = :'speaker_id';
