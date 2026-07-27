-- ============================================================================
-- COMMERCE OS — ESI/ERP mastership (Migration 013)
--
-- The middle-tier compression: on_hand syncs IN from ESI, available syncs OUT
-- to marketplaces, committed is ours alone. Neither ESI nor the marketplaces
-- can produce `available` because neither holds both halves. That is the
-- reason this system exists.
--
-- This migration wires the INBOUND side of the master-consumer relationship
-- with ESI:
--
--   • `erp_inventory_reports` — mirror of channel_inventory_reports but for
--     ESI. Latest row per (product, location) tells us "what ESI believes
--     on_hand is." Populated by ingested `stock.counted` events and by the
--     chaos simulator's ESI drift button.
--   • `_apply_stock_counted` — cycle count. Appends an `adjustment` movement
--     equal to `counted_qty - current_on_hand`. Never edits history — the
--     correction is a new fact, timestamp-preserved.
--   • `_apply_stock_transferred` — paired `transfer_out` + `transfer_in`
--     movements in one transaction. Both locations mutate together.
--   • `_apply_stock_damaged` — negative `damage` movement, no receipt.
--   • `_apply_stock_received_esi` — ESI-side receipt for cases where ESI is
--     authoritative on receiving; complements our own `receive_po_line`.
--   • Extended `process_erp_event` — the ESI equivalent of
--     `process_order_event`. Dedupe on (channel, external_event_id), zod-
--     validated payload, DLQ + retry via the same webhook_events table.
--   • `run_reconciliation` gains a THIRD loop: for each (product, location)
--     with an ESI report, compare ESI's on_hand to ours. Any drift is an
--     `erp_drift` finding with authority INVERTED — ESI's number is
--     `expected`, ours is `actual`. Because ESI is master of on_hand.
--   • `resolve_reconciliation_finding` gains `p_strategy`:
--       'ack'           — flip status (previous behavior; use when the
--                         operator is investigating manually)
--       'accept_source' — for erp_drift: append an `adjustment` movement
--                         bringing on_hand into line with ESI, THEN flip
--                         status. Never edits the ledger — the deferral is
--                         recorded as a new movement with the resolver's
--                         audit trail.
--
-- Not changed: the CHECK (committed <= on_hand) firewall stays. sync-on-
-- change fires on ESI-driven stock movements too — that's how a cycle
-- count at ESI propagates OUT to the marketplaces via the same adapter.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Register 'erp_esi' as a channel — same referential-integrity spine
--    used for marketplaces. Different flow, same shape.
-- ----------------------------------------------------------------------------

insert into channels (id, display_name) values ('erp_esi', 'ESI (ERP)')
  on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1. erp_inventory_reports — ESI's on_hand belief per (product, location)
-- ----------------------------------------------------------------------------

create table erp_inventory_reports (
  id            bigint generated always as identity primary key,
  channel_id    text not null default 'erp_esi',
  product_id    uuid not null references products(id),
  location_id   uuid not null references locations(id),
  reported_qty  integer not null check (reported_qty >= 0),
  reported_at   timestamptz not null default now()
);

create index erp_inventory_reports_lookup
  on erp_inventory_reports (product_id, location_id, reported_at desc);

alter table erp_inventory_reports enable row level security;
grant select, insert on erp_inventory_reports to service_role;

comment on table erp_inventory_reports is
  'ESI/ERP-reported on_hand per (product, location). We are CONSUMER here — '
  'when this disagrees with our on_hand, ESI wins and we post an adjustment.';

-- ----------------------------------------------------------------------------
-- 2. Add 'erp_drift' to reconciliation_findings.kind CHECK
-- ----------------------------------------------------------------------------

alter table reconciliation_findings
  drop constraint reconciliation_findings_kind_check;

alter table reconciliation_findings
  add constraint reconciliation_findings_kind_check
  check (kind in ('ledger_drift','channel_drift','erp_drift'));

-- reconciliation_findings.location_id is nullable per migration 003 — good,
-- because channel_drift is per-(channel, product) with no location. erp_drift
-- IS per-(product, location) though, so it always sets location_id.

-- ----------------------------------------------------------------------------
-- 3. _apply_stock_counted — ESI cycle count arrives; post the delta
--
-- The append-only elegance: we don't edit anything to match ESI. We APPEND
-- an adjustment movement equal to (counted - current). The rollup trigger
-- brings on_hand into line. Six months later, an auditor reads the ledger
-- and sees exactly when we deferred to ESI, by how much, and why.
-- ----------------------------------------------------------------------------

create or replace function _apply_stock_counted(
  p_payload jsonb
) returns table (outcome text, product_id uuid, delta integer)
language plpgsql as $$
#variable_conflict use_column
declare
  v_external_sku text;
  v_location_name text;
  v_counted_qty integer;
  v_product_id uuid;
  v_location_id uuid;
  v_current_on_hand integer;
  v_delta integer;
begin
  v_external_sku  := p_payload->'stock'->>'external_sku';
  v_location_name := coalesce(p_payload->'stock'->>'location', 'Van Nuys DC');
  v_counted_qty   := (p_payload->'stock'->>'counted_qty')::integer;

  if v_external_sku is null or v_counted_qty is null then
    raise exception 'stock.counted payload missing external_sku or counted_qty';
  end if;

  -- Resolve product via any active listing on the ESI feed (or fall through
  -- to a lookup on any channel — ESI knows SKUs by our internal codes too).
  select p.id
    into v_product_id
    from products p
   where p.sku = v_external_sku
   limit 1;

  if v_product_id is null then
    select cl.product_id
      into v_product_id
      from channel_listings cl
     where cl.external_sku = v_external_sku
     order by (cl.channel_id = 'erp_esi') desc
     limit 1;
  end if;

  if v_product_id is null then
    raise exception 'unknown SKU % on ESI count event', v_external_sku;
  end if;

  select id into v_location_id
    from locations
   where name = v_location_name;
  if v_location_id is null then
    raise exception 'unknown location % on ESI count event', v_location_name;
  end if;

  -- Record ESI's belief.
  insert into erp_inventory_reports (product_id, location_id, reported_qty)
    values (v_product_id, v_location_id, v_counted_qty);

  -- Current rollup.
  select coalesce(sl.on_hand, 0)
    into v_current_on_hand
    from stock_levels sl
   where sl.product_id = v_product_id and sl.location_id = v_location_id;

  v_delta := v_counted_qty - coalesce(v_current_on_hand, 0);

  if v_delta = 0 then
    return query select 'no_change'::text, v_product_id, 0;
    return;
  end if;

  -- Append the correction as a fact + update the rollup in the same tx.
  -- Domain functions in this codebase always write both (see receive_po_line,
  -- ship_order); reconciliation verifies they never drift.
  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
  values
    (v_product_id, v_location_id, v_delta, 'adjustment', 'erp_count', null,
     format('ESI cycle count: %s vs %s (delta %s)',
            v_counted_qty, v_current_on_hand, v_delta));

  insert into stock_levels (product_id, location_id, on_hand)
    values (v_product_id, v_location_id, v_counted_qty)
    on conflict (product_id, location_id)
    do update set on_hand = excluded.on_hand;

  return query select 'counted'::text, v_product_id, v_delta;
end $$;

-- ----------------------------------------------------------------------------
-- 4. _apply_stock_transferred — paired transfer_out + transfer_in
-- ----------------------------------------------------------------------------

create or replace function _apply_stock_transferred(
  p_payload jsonb
) returns table (outcome text, product_id uuid, qty integer)
language plpgsql as $$
#variable_conflict use_column
declare
  v_external_sku text;
  v_from_name text;
  v_to_name text;
  v_qty integer;
  v_product_id uuid;
  v_from_id uuid;
  v_to_id uuid;
begin
  v_external_sku := p_payload->'transfer'->>'external_sku';
  v_from_name    := p_payload->'transfer'->>'from_location';
  v_to_name      := p_payload->'transfer'->>'to_location';
  v_qty          := (p_payload->'transfer'->>'qty')::integer;

  if v_external_sku is null or v_from_name is null or v_to_name is null or v_qty is null then
    raise exception 'stock.transferred payload missing required fields';
  end if;

  if v_qty <= 0 then
    raise exception 'stock.transferred qty must be positive, got %', v_qty;
  end if;

  select p.id into v_product_id from products p where p.sku = v_external_sku limit 1;
  if v_product_id is null then
    raise exception 'unknown SKU % on ESI transfer', v_external_sku;
  end if;

  select id into v_from_id from locations where name = v_from_name;
  select id into v_to_id from locations where name = v_to_name;
  if v_from_id is null or v_to_id is null then
    raise exception 'unknown location(s) on transfer: from=% to=%',
      v_from_name, v_to_name;
  end if;

  -- Both movements + both rollups in one transaction. If the transfer_out
  -- would drop on_hand below committed at source, the CHECK firewall catches
  -- it and the whole tx rolls back — including the destination increment.
  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
  values
    (v_product_id, v_from_id, -v_qty, 'transfer_out', 'erp_transfer', null,
     format('ESI transfer to %s', v_to_name));

  update stock_levels
     set on_hand = on_hand - v_qty
   where product_id = v_product_id and location_id = v_from_id;

  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
  values
    (v_product_id, v_to_id, v_qty, 'transfer_in', 'erp_transfer', null,
     format('ESI transfer from %s', v_from_name));

  insert into stock_levels (product_id, location_id, on_hand)
    values (v_product_id, v_to_id, v_qty)
    on conflict (product_id, location_id)
    do update set on_hand = stock_levels.on_hand + v_qty;

  return query select 'transferred'::text, v_product_id, v_qty;
end $$;

-- ----------------------------------------------------------------------------
-- 5. _apply_stock_damaged — a negative damage movement, no receipt
-- ----------------------------------------------------------------------------

create or replace function _apply_stock_damaged(
  p_payload jsonb
) returns table (outcome text, product_id uuid, qty integer)
language plpgsql as $$
#variable_conflict use_column
declare
  v_external_sku text;
  v_location_name text;
  v_qty integer;
  v_reason_note text;
  v_product_id uuid;
  v_location_id uuid;
begin
  v_external_sku  := p_payload->'damage'->>'external_sku';
  v_location_name := coalesce(p_payload->'damage'->>'location', 'Van Nuys DC');
  v_qty           := (p_payload->'damage'->>'qty')::integer;
  v_reason_note   := coalesce(p_payload->'damage'->>'note', 'ESI-reported damage');

  if v_external_sku is null or v_qty is null then
    raise exception 'stock.damaged payload missing external_sku or qty';
  end if;
  if v_qty <= 0 then
    raise exception 'stock.damaged qty must be positive, got %', v_qty;
  end if;

  select p.id into v_product_id from products p where p.sku = v_external_sku limit 1;
  if v_product_id is null then
    raise exception 'unknown SKU % on ESI damage event', v_external_sku;
  end if;

  select id into v_location_id from locations where name = v_location_name;
  if v_location_id is null then
    raise exception 'unknown location % on ESI damage event', v_location_name;
  end if;

  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
  values
    (v_product_id, v_location_id, -v_qty, 'damage', 'erp_damage', null, v_reason_note);

  update stock_levels
     set on_hand = on_hand - v_qty
   where product_id = v_product_id and location_id = v_location_id;

  return query select 'damaged'::text, v_product_id, v_qty;
end $$;

-- ----------------------------------------------------------------------------
-- 6. process_erp_event — the ESI counterpart of process_order_event
-- ----------------------------------------------------------------------------

create or replace function process_erp_event(
  p_channel_id        text,
  p_external_event_id text,
  p_event_type        text,
  p_payload           jsonb,
  p_signature_valid   boolean
) returns jsonb
language plpgsql as $$
declare
  v_event_id uuid;
  v_result   record;
begin
  -- Dedupe on (channel, external_event_id) — same guarantee as orders.
  insert into webhook_events
    (channel_id, external_event_id, event_type, payload, signature_valid)
    values
    (p_channel_id, p_external_event_id, p_event_type, p_payload, p_signature_valid)
    on conflict (channel_id, external_event_id) do nothing
    returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'deduped');
  end if;

  if not p_signature_valid then
    update webhook_events
       set status = 'dead',
           last_error = 'invalid signature',
           processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('outcome', 'dead', 'reason', 'invalid signature');
  end if;

  begin
    case p_event_type
      when 'stock.counted' then
        select * into v_result from _apply_stock_counted(p_payload);
      when 'stock.transferred' then
        select * into v_result from _apply_stock_transferred(p_payload);
      when 'stock.damaged' then
        select * into v_result from _apply_stock_damaged(p_payload);
      else
        raise exception 'unknown ESI event type: %', p_event_type;
    end case;

    update webhook_events
       set status = 'processed', processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'outcome', 'processed',
      'event_type', p_event_type,
      'result', to_jsonb(v_result)
    );

  exception when others then
    update webhook_events
       set status = 'failed',
           last_error = SQLERRM,
           processed_at = now()
     where id = v_event_id;
    return jsonb_build_object(
      'outcome', 'failed',
      'event_type', p_event_type,
      'error', SQLERRM
    );
  end;
end $$;

grant execute on function
  _apply_stock_counted(jsonb),
  _apply_stock_transferred(jsonb),
  _apply_stock_damaged(jsonb),
  process_erp_event(text, text, text, jsonb, boolean)
to service_role;

-- ----------------------------------------------------------------------------
-- 7. Extend run_reconciliation with the erp_drift loop (backstop for ESI)
--
-- Third loop, authority INVERTED: ESI's reported_qty is `expected`, our
-- on_hand is `actual`. When they disagree, ESI wins by design — we're
-- consumers, not owners, of on_hand.
--
-- Auto-resolve applies to erp_drift too: if ESI's latest report now matches
-- our on_hand (because someone accepted the drift), the finding closes.
-- ----------------------------------------------------------------------------

create or replace function resolve_findings_with_no_drift() returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  -- channel_drift auto-resolve (unchanged from migration 012)
  with latest_reports as (
    select distinct on (channel_id, product_id)
           channel_id, product_id, reported_qty
      from channel_inventory_reports
     order by channel_id, product_id, reported_at desc
  ),
  now_avail as (
    select f.id as finding_id, f.channel_id, f.product_id,
           coalesce((select available from available_to_sell a where a.product_id = f.product_id), 0) as available,
           lr.reported_qty
      from reconciliation_findings f
      left join latest_reports lr on lr.channel_id = f.channel_id and lr.product_id = f.product_id
     where f.status = 'open'
       and f.kind = 'channel_drift'
  ),
  to_resolve as (
    select finding_id from now_avail where reported_qty is not null and available = reported_qty
  )
  update reconciliation_findings
     set status = 'resolved'
   where id in (select finding_id from to_resolve);
  get diagnostics v_count = row_count;

  -- erp_drift auto-resolve (new)
  with latest_erp as (
    select distinct on (product_id, location_id)
           product_id, location_id, reported_qty
      from erp_inventory_reports
     order by product_id, location_id, reported_at desc
  ),
  now_state as (
    select f.id as finding_id, f.product_id, f.location_id,
           coalesce(sl.on_hand, 0) as on_hand,
           le.reported_qty
      from reconciliation_findings f
      left join stock_levels sl on sl.product_id = f.product_id and sl.location_id = f.location_id
      left join latest_erp le on le.product_id = f.product_id and le.location_id = f.location_id
     where f.status = 'open'
       and f.kind = 'erp_drift'
  ),
  to_resolve as (
    select finding_id from now_state where reported_qty is not null and on_hand = reported_qty
  )
  update reconciliation_findings
     set status = 'resolved'
   where id in (select finding_id from to_resolve);

  return v_count;
end $$;

create or replace function run_reconciliation() returns uuid
language plpgsql as $$
declare
  v_run    uuid;
  lvl      record;
  rep      record;
  esi      record;
  v_ledger integer;
  v_avail  integer;
  v_count  integer;
  v_new_finding_id bigint;
begin
  -- (0) auto-heal
  perform resolve_findings_with_no_drift();

  insert into reconciliation_runs default values returning id into v_run;

  -- (a) internal drift: rollup vs ledger
  for lvl in select product_id, location_id, on_hand from stock_levels loop
    select coalesce(sum(qty_delta), 0)::integer into v_ledger
    from stock_movements m
    where m.product_id = lvl.product_id and m.location_id = lvl.location_id;

    if v_ledger <> lvl.on_hand then
      insert into reconciliation_findings
        (run_id, kind, product_id, location_id, expected, actual, delta)
      values
        (v_run, 'ledger_drift', lvl.product_id, lvl.location_id,
         v_ledger, lvl.on_hand, lvl.on_hand - v_ledger);
    end if;
  end loop;

  -- (b) channel drift: marketplace-reported qty vs available-to-sell
  for rep in
    select distinct on (channel_id, product_id)
           channel_id, product_id, reported_qty
      from channel_inventory_reports
     order by channel_id, product_id, reported_at desc
  loop
    select coalesce(
      (select available from available_to_sell a where a.product_id = rep.product_id), 0
    ) into v_avail;

    if v_avail <> rep.reported_qty then
      insert into reconciliation_findings
        (run_id, kind, product_id, channel_id, expected, actual, delta)
      values
        (v_run, 'channel_drift', rep.product_id, rep.channel_id,
         v_avail, rep.reported_qty, rep.reported_qty - v_avail)
      returning id into v_new_finding_id;

      -- Backstop outbox emit for the marketplace-side push.
      insert into outbox
        (aggregate_type, aggregate_id, event_type, payload)
      values
        ('marketplace_inventory', rep.product_id, 'inventory.sync',
         jsonb_build_object(
           'channel_id',   rep.channel_id,
           'product_id',   rep.product_id,
           'correct_qty',  v_avail,
           'source',       'reconciliation',
           'finding_id',   v_new_finding_id
         ));
    end if;
  end loop;

  -- (c) ERP drift: ESI-reported on_hand vs our stock_levels.on_hand.
  -- Authority INVERTED here: ESI is master of on_hand. expected = ESI's
  -- number, actual = ours. Resolution proposes an adjustment movement.
  for esi in
    select distinct on (product_id, location_id)
           product_id, location_id, reported_qty
      from erp_inventory_reports
     order by product_id, location_id, reported_at desc
  loop
    select coalesce(sl.on_hand, 0) into v_avail
      from stock_levels sl
     where sl.product_id = esi.product_id and sl.location_id = esi.location_id;

    if v_avail <> esi.reported_qty then
      insert into reconciliation_findings
        (run_id, kind, product_id, location_id, expected, actual, delta)
      values
        (v_run, 'erp_drift', esi.product_id, esi.location_id,
         esi.reported_qty, v_avail, v_avail - esi.reported_qty);
    end if;
  end loop;

  select count(*)::integer into v_count
    from reconciliation_findings where run_id = v_run;

  update reconciliation_runs
     set finished_at = now(), findings_count = v_count
   where id = v_run;

  return v_run;
end $$;

-- ----------------------------------------------------------------------------
-- 8. resolve_reconciliation_finding — gains p_strategy
--
-- 'ack' preserves the historic behavior — flip status, no ledger side-effect.
-- 'accept_source' is the ESI-master path: append an `adjustment` movement
-- that brings our on_hand into line with the source's reported qty. The
-- ledger records exactly when we deferred and by how much.
-- ----------------------------------------------------------------------------

create or replace function resolve_reconciliation_finding(
  p_finding_id bigint,
  p_strategy   text default 'ack',
  p_note       text default null
) returns jsonb
language plpgsql as $$
declare
  v_finding record;
  v_delta   integer;
begin
  select * into v_finding
    from reconciliation_findings
   where id = p_finding_id
   for update;

  if v_finding.id is null then
    raise exception 'reconciliation_finding % not found', p_finding_id;
  end if;

  if v_finding.status <> 'open' then
    return jsonb_build_object('outcome', 'already_resolved', 'finding_id', p_finding_id);
  end if;

  if p_strategy = 'accept_source' then
    if v_finding.kind = 'erp_drift' then
      -- ESI's on_hand is authoritative; append an adjustment closing the gap.
      -- v_finding.expected = ESI, v_finding.actual = ours. delta = ESI - ours.
      -- (ref_id is uuid in stock_movements; keep the finding id in the note
      -- so the audit trail is preserved without a cross-type reference.)
      v_delta := v_finding.expected - v_finding.actual;

      insert into stock_movements
        (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
      values
        (v_finding.product_id, v_finding.location_id, v_delta,
         'adjustment', 'reconciliation', null,
         coalesce(p_note, format('accepted ESI count (finding %s, delta %s)',
                                 p_finding_id, v_delta)));

      update stock_levels
         set on_hand = on_hand + v_delta
       where product_id = v_finding.product_id
         and location_id = v_finding.location_id;

    elsif v_finding.kind = 'channel_drift' then
      -- For channel_drift, accept-source means "we accept the marketplace
      -- is right and their number reflects a decision we didn't make."
      -- Nothing to append to the ledger (marketplaces don't move stock);
      -- fall through to status flip. This branch exists so the API is
      -- consistent for future channel-master flows we haven't specced.
      null;

    elsif v_finding.kind = 'ledger_drift' then
      -- ledger_drift means rollup and ledger disagree — that is a code
      -- bug, not a mastership question. accept_source doesn't apply.
      raise exception 'accept_source is not valid for ledger_drift findings';
    end if;
  end if;

  update reconciliation_findings
     set status = 'resolved'
   where id = p_finding_id;

  return jsonb_build_object(
    'outcome', 'resolved',
    'finding_id', p_finding_id,
    'strategy', p_strategy
  );
end $$;

grant execute on function
  resolve_reconciliation_finding(bigint, text, text),
  run_reconciliation()
to service_role;

-- ----------------------------------------------------------------------------
-- 9. Small chaos helpers for ESI: skew (report a wrong number) + count
-- ----------------------------------------------------------------------------

create or replace function skew_erp_report(
  p_sku          text,
  p_location     text,
  p_delta        integer
) returns jsonb
language plpgsql as $$
declare
  v_product_id uuid;
  v_location_id uuid;
  v_current_on_hand integer;
  v_reported integer;
begin
  select id into v_product_id from products where sku = p_sku limit 1;
  if v_product_id is null then
    raise exception 'unknown SKU % for ESI skew', p_sku;
  end if;

  select id into v_location_id from locations where name = p_location;
  if v_location_id is null then
    raise exception 'unknown location % for ESI skew', p_location;
  end if;

  select coalesce(on_hand, 0) into v_current_on_hand
    from stock_levels
   where product_id = v_product_id and location_id = v_location_id;

  v_reported := greatest(0, coalesce(v_current_on_hand, 0) + p_delta);

  insert into erp_inventory_reports (product_id, location_id, reported_qty)
    values (v_product_id, v_location_id, v_reported);

  return jsonb_build_object(
    'outcome', 'skewed',
    'product_id', v_product_id,
    'location_id', v_location_id,
    'our_on_hand', v_current_on_hand,
    'reported', v_reported,
    'delta', p_delta
  );
end $$;

grant execute on function skew_erp_report(text, text, integer) to service_role;
