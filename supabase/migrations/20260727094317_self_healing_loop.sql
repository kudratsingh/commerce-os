-- ============================================================================
-- COMMERCE OS — Sync-on-change + reconciliation-backstop (Migration 012)
--
-- ADR-010. Closes the outbound side of the wire with two loops:
--
--   PRIMARY: sync-on-change. A trigger on `stock_levels` emits an
--   `inventory.sync` outbox row per active `channel_listing` whenever
--   `on_hand` or `committed` moves. The sweeper dispatches through the
--   MarketplaceAdapter port; the SimulatedTikTok fake overwrites its
--   belief in `channel_inventory_reports`. Every allocation, ship,
--   receive, cancel, and return pushes the new sellable number out
--   without a human touching the reconciliation panel.
--
--   BACKSTOP: reconciliation-push. `run_reconciliation` compares our
--   `available_to_sell` to the marketplace's last report. Any drift
--   (a sync-on-change delivery that got dropped, an outage window) also
--   writes an `inventory.sync` outbox row, tagged `source: 'reconciliation'`.
--   Findings auto-resolve when the delta closes.
--
-- Also adds:
--   • `simulator_config` — tiny key/value. `hostile_rate` drives the fake
--     adapter's simulated-429 rate.
--   • `outbox_claim_batch` — two-phase claim (SKIP LOCKED, sets
--     `in_flight`). `outbox_deliver_batch` (one-shot) stays for the
--     older tests.
--   • `resolve_findings_with_no_drift` — closes the loop's audit trail.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. simulator_config — tiny key/value
-- ----------------------------------------------------------------------------

create table simulator_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table simulator_config enable row level security;

insert into simulator_config (key, value) values
  ('hostile_rate', to_jsonb(0::numeric))
on conflict (key) do nothing;

create or replace function set_simulator_config(p_key text, p_value jsonb)
returns void
language sql as $$
  insert into simulator_config (key, value)
    values (p_key, p_value)
    on conflict (key) do update
    set value = excluded.value, updated_at = now();
$$;

create or replace function get_simulator_config(p_key text)
returns jsonb
language sql as $$
  select value from simulator_config where key = p_key;
$$;

-- ----------------------------------------------------------------------------
-- 2. Extend outbox status enum with 'in_flight'
--
-- We can't ALTER a check constraint's set in place; drop + recreate is the
-- only clean move. Preserves existing rows (none of them use 'in_flight').
-- ----------------------------------------------------------------------------

alter table outbox drop constraint outbox_status_check;
alter table outbox add constraint outbox_status_check
  check (status in ('pending','in_flight','delivered','failed','dead'));

-- ----------------------------------------------------------------------------
-- 3. outbox_claim_batch — two-phase claim
--
-- Atomically moves due rows into `in_flight` and returns their content
-- so the caller can dispatch each to an external handler. The caller MUST
-- follow up with either outbox_mark_delivered or outbox_mark_failed —
-- rows stuck in `in_flight` past a claim TTL are re-claimable by a
-- follow-up sweep. TTL sweep is left as a follow-up; for now the sweeper
-- is fast enough that we never see the case.
-- ----------------------------------------------------------------------------

create or replace function outbox_claim_batch(p_limit int default 50)
returns table (id bigint, event_type text, aggregate_id uuid, payload jsonb)
language sql as $$
  update outbox
     set status = 'in_flight'
   where outbox.id in (
     select o.id
       from outbox o
      where o.status in ('pending', 'failed')
        and o.next_attempt_at <= now()
      order by o.next_attempt_at
      limit p_limit
      for update skip locked
   )
   returning outbox.id, outbox.event_type, outbox.aggregate_id, outbox.payload;
$$;

create or replace function outbox_mark_delivered(p_id bigint)
returns void
language sql as $$
  update outbox
     set status = 'delivered',
         delivered_at = now(),
         last_error = null
   where id = p_id;
$$;

-- outbox_mark_failed already exists (migration 003) and does the right
-- thing (attempts++, backoff, DLQ after max_attempts). We keep using it.

grant execute on function
  set_simulator_config(text, jsonb),
  get_simulator_config(text),
  outbox_claim_batch(int),
  outbox_mark_delivered(bigint)
to service_role;
grant select, insert, update on simulator_config to service_role;

-- ----------------------------------------------------------------------------
-- 4. resolve_findings_with_no_drift — auto-close after correction
--
-- The sweeper corrects the marketplace by writing a new
-- channel_inventory_reports row that matches available_to_sell. The next
-- reconciliation run reads that fresh row (DISTINCT ON received_at desc
-- from ADR-001 wiring) and sees zero delta. Any open channel_drift
-- findings for that (channel, product) whose current delta is zero can
-- be auto-resolved.
-- ----------------------------------------------------------------------------

create or replace function resolve_findings_with_no_drift() returns integer
language plpgsql as $$
declare
  v_count integer;
begin
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
  return v_count;
end $$;

-- ----------------------------------------------------------------------------
-- 5. run_reconciliation — extend to (a) auto-resolve, (b) emit outbox
--
-- Full body rewritten from migration 003 with two additions:
--   • Before scanning for new drift, call resolve_findings_with_no_drift.
--     Old findings that are now healed close automatically. The DEMO
--     wants "click Run again, watch red rows disappear."
--   • After writing new channel_drift findings, emit an outbox row per
--     finding so the sweeper can dispatch a corrective updateInventory
--     call through the adapter port.
-- ----------------------------------------------------------------------------

create or replace function run_reconciliation() returns uuid
language plpgsql as $$
declare
  v_run    uuid;
  lvl      record;
  rep      record;
  v_ledger integer;
  v_avail  integer;
  v_count  integer;
  v_new_finding_id bigint;
begin
  -- (0) auto-heal findings whose drift is now zero
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

  -- (b) external drift: marketplace-reported qty vs available-to-sell
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

      -- Emit outbox row so the sweeper can dispatch a correction through
      -- the MarketplaceAdapter port. This is the BACKSTOP; the sync-on-
      -- change trigger below is what pushes on every stock movement.
      -- Reconciliation-emitted rows carry a finding_id so the delivery
      -- can be traced back to the run that caught the drift.
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

  select count(*)::integer into v_count
    from reconciliation_findings where run_id = v_run;

  update reconciliation_runs
     set finished_at = now(), findings_count = v_count
   where id = v_run;

  return v_run;
end $$;

grant execute on function
  resolve_findings_with_no_drift(),
  run_reconciliation()
to service_role;

-- ----------------------------------------------------------------------------
-- 6. Sync-on-change trigger — the PRIMARY flow
--
-- Every time stock_levels is updated (allocation, ship, receive, cancel,
-- return, adjustment), emit one `inventory.sync` outbox row per active
-- channel_listing for this product. The sweeper delivers each one via
-- the adapter, keeping the marketplace's belief current without any
-- reconciliation involvement on the happy path. Reconciliation exists
-- only to catch what THIS flow missed.
--
-- Guard against no-op updates (both on_hand and committed unchanged) so
-- an idempotent update doesn't spam the outbox.
-- ----------------------------------------------------------------------------

create or replace function _emit_inventory_sync_on_stock_change()
returns trigger
language plpgsql as $$
declare
  v_channel_listing record;
  v_available       integer;
begin
  -- Nothing changed? Nothing to sync.
  if (new.on_hand = old.on_hand) and (new.committed = old.committed) then
    return new;
  end if;

  v_available := new.on_hand - new.committed;

  for v_channel_listing in
    select cl.channel_id
      from channel_listings cl
     where cl.product_id = new.product_id
       and cl.active
  loop
    insert into outbox
      (aggregate_type, aggregate_id, event_type, payload)
    values
      ('marketplace_inventory', new.product_id, 'inventory.sync',
       jsonb_build_object(
         'channel_id',   v_channel_listing.channel_id,
         'product_id',   new.product_id,
         'correct_qty',  v_available,
         'source',       'stock_change'
       ));
  end loop;

  return new;
end $$;

create trigger stock_levels_emit_sync
after update on stock_levels
for each row execute function _emit_inventory_sync_on_stock_change();

-- Also fire on the initial INSERT (a new product+location just came into
-- existence — e.g., first receipt at a location). Same handler, but READs
-- OLD wouldn't work; use a separate trigger that treats "everything is new."
create or replace function _emit_inventory_sync_on_stock_insert()
returns trigger
language plpgsql as $$
declare
  v_channel_listing record;
  v_available       integer;
begin
  v_available := new.on_hand - new.committed;

  for v_channel_listing in
    select cl.channel_id
      from channel_listings cl
     where cl.product_id = new.product_id
       and cl.active
  loop
    insert into outbox
      (aggregate_type, aggregate_id, event_type, payload)
    values
      ('marketplace_inventory', new.product_id, 'inventory.sync',
       jsonb_build_object(
         'channel_id',   v_channel_listing.channel_id,
         'product_id',   new.product_id,
         'correct_qty',  v_available,
         'source',       'stock_change'
       ));
  end loop;

  return new;
end $$;

create trigger stock_levels_emit_sync_insert
after insert on stock_levels
for each row execute function _emit_inventory_sync_on_stock_insert();
