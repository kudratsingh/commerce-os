-- ============================================================================
-- COMMERCE OS — Core Schema (Migration 001)
-- A hardened multi-brand inventory + order ledger for marketplace commerce.
-- Target: Supabase (Postgres 15+). Run via Supabase CLI migrations or SQL editor.
--
-- Design principles (know these cold — they ARE the interview):
--   1. stock_movements is an APPEND-ONLY LEDGER. Physical truth. Never mutated.
--   2. stock_levels is a FAST ROLLUP with CHECK constraints as the last line
--      of defense against overselling. Ledger and rollup are reconciled by a
--      job that proves they agree (drift detection).
--   3. Every external input is deduplicated at the door (webhook_events) and
--      every side effect is recorded transactionally (outbox). At-least-once
--      delivery in, exactly-once effects out.
--   4. brand_id everywhere = multi-tenant by construction (brands are tenants).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. TENANCY & CATALOG
-- ----------------------------------------------------------------------------

create table brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null check (kind in ('warehouse', '3pl')),
  created_at  timestamptz not null default now()
);

create table channels (
  id           text primary key,            -- 'tiktok_shop', 'amazon', ...
  display_name text not null
);

create table products (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id),
  sku          text not null,
  title        text not null,
  cost_cents   integer not null check (cost_cents >= 0),
  price_cents  integer not null check (price_cents >= 0),
  created_at   timestamptz not null default now(),
  unique (brand_id, sku)
);

-- Maps our product to each marketplace's identifier. Webhooks arrive speaking
-- the marketplace's language (external_sku); this table translates.
create table channel_listings (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id),
  channel_id   text not null references channels(id),
  external_sku text not null,
  active       boolean not null default true,
  unique (channel_id, external_sku)
);

-- ----------------------------------------------------------------------------
-- 2. PURCHASING (inbound stock)
-- ----------------------------------------------------------------------------

create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id),
  supplier    text not null,
  status      text not null default 'placed'
              check (status in ('draft','placed','partially_received','received','closed')),
  expected_at date,
  created_at  timestamptz not null default now()
);

create table purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  product_id        uuid not null references products(id),
  qty_ordered       integer not null check (qty_ordered > 0),
  unit_cost_cents   integer not null check (unit_cost_cents >= 0)
);

-- A receipt is the physical event of stock arriving. Receipts write ledger
-- entries; they are the ONLY way on_hand increases in normal operation.
create table receipts (
  id                     uuid primary key default gen_random_uuid(),
  purchase_order_line_id uuid not null references purchase_order_lines(id),
  location_id            uuid not null references locations(id),
  qty_received           integer not null check (qty_received > 0),
  received_at            timestamptz not null default now(),
  received_by            text not null default 'system'
);

-- ----------------------------------------------------------------------------
-- 3. ORDERS (outbound demand)
-- ----------------------------------------------------------------------------

create table orders (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id),
  channel_id        text not null references channels(id),
  external_order_id text not null,
  status            text not null default 'received'
                    check (status in ('received','allocated','backordered',
                                      'shipped','delivered','cancelled','refunded')),
  buyer_handle      text,
  subtotal_cents    integer not null default 0 check (subtotal_cents >= 0),
  placed_at         timestamptz not null,
  raw_payload       jsonb,                  -- original webhook body, for audit
  created_at        timestamptz not null default now(),
  -- ORDER-LEVEL IDEMPOTENCY: the same marketplace order can never exist twice.
  unique (channel_id, external_order_id)
);

create table order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id),
  product_id       uuid not null references products(id),
  qty              integer not null check (qty > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

-- ----------------------------------------------------------------------------
-- 4. THE LEDGER (append-only physical truth)
-- ----------------------------------------------------------------------------
-- Every unit that physically moves is one immutable row. Current stock is
-- derivable as SUM(qty_delta). Auditability is free: "why is on_hand 37?"
-- has an answer you can scroll through.

create table stock_movements (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references products(id),
  location_id uuid not null references locations(id),
  qty_delta   integer not null check (qty_delta <> 0),
  reason      text not null check (reason in
                ('po_receipt','order_shipment','return_received',
                 'adjustment','transfer_in','transfer_out','damage')),
  ref_type    text,            -- 'receipt' | 'order' | 'manual' ...
  ref_id      uuid,            -- id of the source document
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text not null default 'system'
);

-- Enforce append-only at the database level, not by convention.
create or replace function forbid_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is append-only (attempted %)', tg_op;
end $$;

create trigger stock_movements_immutable
  before update or delete on stock_movements
  for each row execute function forbid_ledger_mutation();

-- ----------------------------------------------------------------------------
-- 5. THE ROLLUP (fast reads + the oversell firewall)
-- ----------------------------------------------------------------------------
-- on_hand   = physical units at the location (must equal SUM of ledger)
-- committed = units reserved by allocated-but-unshipped orders
-- available = on_hand - committed (derived)
--
-- The CHECK (committed <= on_hand) makes overselling a database error, not a
-- customer-support incident. Even a buggy code path cannot violate it.

create table stock_levels (
  product_id  uuid not null references products(id),
  location_id uuid not null references locations(id),
  on_hand     integer not null default 0 check (on_hand >= 0),
  committed   integer not null default 0 check (committed >= 0),
  primary key (product_id, location_id),
  check (committed <= on_hand)
);

-- ----------------------------------------------------------------------------
-- 6. INGESTION IDEMPOTENCY + OUTBOX
-- ----------------------------------------------------------------------------

-- Every inbound webhook lands here first. The UNIQUE constraint is the dedupe
-- gate: INSERT ... ON CONFLICT DO NOTHING. A duplicate delivery becomes a
-- no-op instead of a double-allocated order.
create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  channel_id        text not null references channels(id),
  external_event_id text not null,
  event_type        text not null,
  payload           jsonb not null,
  signature_valid   boolean not null,
  status            text not null default 'received'
                    check (status in ('received','processed','failed','dead')),
  attempts          integer not null default 0,
  last_error        text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (channel_id, external_event_id)
);

-- Transactional outbox: domain writes and their side-effect intents commit
-- together. A sweeper (Workers Cron Trigger — see cron-worker/ and ADR-005)
-- delivers them with retries. A crash between commit and delivery loses
-- nothing.
create table outbox (
  id              bigint generated always as identity primary key,
  aggregate_type  text not null,             -- 'order', 'inventory', ...
  aggregate_id    uuid,
  event_type      text not null,             -- 'order.allocated', 'stock.low', ...
  payload         jsonb not null,
  status          text not null default 'pending'
                  check (status in ('pending','delivered','failed','dead')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);

create index outbox_sweep_idx on outbox (status, next_attempt_at)
  where status in ('pending','failed');

-- ----------------------------------------------------------------------------
-- 7. RECONCILIATION (trust, but verify)
-- ----------------------------------------------------------------------------

-- What each marketplace claims our sellable quantity is (in production this
-- is fetched from their APIs; in the demo the simulator writes it).
create table channel_inventory_reports (
  id           bigint generated always as identity primary key,
  channel_id   text not null references channels(id),
  product_id   uuid not null references products(id),
  reported_qty integer not null check (reported_qty >= 0),
  reported_at  timestamptz not null default now()
);

create table reconciliation_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  findings_count integer
);

create table reconciliation_findings (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references reconciliation_runs(id),
  kind        text not null check (kind in ('ledger_drift','channel_drift')),
  product_id  uuid not null references products(id),
  location_id uuid references locations(id),
  channel_id  text references channels(id),
  expected    integer not null,   -- what the source of truth says
  actual      integer not null,   -- what the system under test says
  delta       integer not null,
  status      text not null default 'open' check (status in ('open','resolved')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. VIEWS (read models)
-- ----------------------------------------------------------------------------

create view current_stock_from_ledger as
select product_id,
       location_id,
       coalesce(sum(qty_delta), 0)::integer as on_hand_ledger
from stock_movements
group by product_id, location_id;

create view available_to_sell as
select product_id,
       sum(on_hand - committed)::integer as available
from stock_levels
group by product_id;

create view gmv_today as
select o.brand_id,
       o.channel_id,
       count(*)::integer                    as orders_count,
       coalesce(sum(o.subtotal_cents), 0)::bigint as gmv_cents
from orders o
where o.placed_at >= date_trunc('day', now())
  and o.status not in ('cancelled', 'refunded')
group by o.brand_id, o.channel_id;

-- ----------------------------------------------------------------------------
-- 9. DOMAIN FUNCTIONS (atomic operations, callable via RPC)
-- ----------------------------------------------------------------------------

-- Receive stock against a PO line. The ONLY normal path that raises on_hand.
-- Ledger entry + rollup update commit atomically.
create or replace function receive_po_line(
  p_po_line_id  uuid,
  p_location_id uuid,
  p_qty         integer,
  p_by          text default 'system'
) returns uuid
language plpgsql as $$
declare
  v_product_id uuid;
  v_receipt_id uuid;
begin
  select product_id into v_product_id
  from purchase_order_lines where id = p_po_line_id;
  if v_product_id is null then
    raise exception 'unknown purchase_order_line %', p_po_line_id;
  end if;

  insert into receipts (purchase_order_line_id, location_id, qty_received, received_by)
  values (p_po_line_id, p_location_id, p_qty, p_by)
  returning id into v_receipt_id;

  insert into stock_movements (product_id, location_id, qty_delta, reason, ref_type, ref_id, created_by)
  values (v_product_id, p_location_id, p_qty, 'po_receipt', 'receipt', v_receipt_id, p_by);

  insert into stock_levels (product_id, location_id, on_hand, committed)
  values (v_product_id, p_location_id, p_qty, 0)
  on conflict (product_id, location_id)
  do update set on_hand = stock_levels.on_hand + excluded.on_hand;

  return v_receipt_id;
end $$;

-- Allocate an order: reserve stock without moving it physically.
-- The conditional UPDATE (on_hand - committed >= qty) is the oversell guard;
-- the plpgsql exception block gives all-or-nothing semantics across lines
-- (a failed line rolls back the lines already reserved in this call).
create or replace function allocate_order(
  p_order_id    uuid,
  p_location_id uuid
) returns text
language plpgsql as $$
declare
  line record;
begin
  -- serialize concurrent processing of the same order
  perform 1 from orders where id = p_order_id for update;

  begin
    for line in
      select ol.product_id, ol.qty
      from order_lines ol
      where ol.order_id = p_order_id
      order by ol.product_id            -- stable lock order prevents deadlocks
    loop
      update stock_levels
         set committed = committed + line.qty
       where product_id  = line.product_id
         and location_id = p_location_id
         and on_hand - committed >= line.qty;

      if not found then
        raise exception 'insufficient stock for product %', line.product_id;
      end if;
    end loop;

    update orders set status = 'allocated' where id = p_order_id;
    return 'allocated';

  exception when others then
    -- block-level rollback undid the partial reservations; record the outcome
    update orders set status = 'backordered' where id = p_order_id;
    return 'backordered';
  end;
end $$;

-- Ship an allocated order: the physical event. Writes negative ledger entries
-- and releases the reservation in the same transaction.
create or replace function ship_order(
  p_order_id    uuid,
  p_location_id uuid
) returns void
language plpgsql as $$
declare
  line record;
  v_status text;
begin
  select status into v_status from orders where id = p_order_id for update;
  if v_status is distinct from 'allocated' then
    raise exception 'order % is % — only allocated orders ship', p_order_id, v_status;
  end if;

  for line in
    select ol.product_id, ol.qty
    from order_lines ol where ol.order_id = p_order_id
    order by ol.product_id
  loop
    update stock_levels
       set on_hand   = on_hand   - line.qty,
           committed = committed - line.qty
     where product_id = line.product_id
       and location_id = p_location_id;

    insert into stock_movements (product_id, location_id, qty_delta, reason, ref_type, ref_id)
    values (line.product_id, p_location_id, -line.qty, 'order_shipment', 'order', p_order_id);
  end loop;

  update orders set status = 'shipped' where id = p_order_id;
end $$;

-- Cancel an order; release the reservation if one was held.
create or replace function cancel_order(
  p_order_id    uuid,
  p_location_id uuid
) returns void
language plpgsql as $$
declare
  line record;
  v_status text;
begin
  select status into v_status from orders where id = p_order_id for update;

  if v_status = 'allocated' then
    for line in
      select ol.product_id, ol.qty
      from order_lines ol where ol.order_id = p_order_id
    loop
      update stock_levels
         set committed = committed - line.qty
       where product_id = line.product_id
         and location_id = p_location_id;
    end loop;
  end if;

  update orders set status = 'cancelled' where id = p_order_id;
end $$;

-- Reconciliation: prove the rollup equals the ledger, and compare our
-- availability against what each marketplace last reported.
create or replace function run_reconciliation() returns uuid
language plpgsql as $$
declare
  v_run uuid;
  lvl record;
  rep record;
  v_ledger integer;
  v_avail  integer;
  v_count  integer;
begin
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

  -- (b) external drift: marketplace-reported qty vs our available-to-sell
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
         v_avail, rep.reported_qty, rep.reported_qty - v_avail);
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
-- 10. ROW LEVEL SECURITY (multi-tenant isolation)
-- ----------------------------------------------------------------------------
-- Brands are tenants. Ops dashboards run server-side with the service role
-- (bypasses RLS); a future per-brand client portal authenticates with a JWT
-- carrying brand_id, and these policies scope every query automatically.
-- Stock tables are scoped through their product's brand via join policies
-- when the portal ships; kept simple here.

alter table brands          enable row level security;
alter table products        enable row level security;
alter table purchase_orders enable row level security;
alter table orders          enable row level security;

create policy brand_isolation_products on products
  for select using (brand_id = (auth.jwt() ->> 'brand_id')::uuid);

create policy brand_isolation_pos on purchase_orders
  for select using (brand_id = (auth.jwt() ->> 'brand_id')::uuid);

create policy brand_isolation_orders on orders
  for select using (brand_id = (auth.jwt() ->> 'brand_id')::uuid);

create policy brand_self on brands
  for select using (id = (auth.jwt() ->> 'brand_id')::uuid);

-- ----------------------------------------------------------------------------
-- 11. INDEXES
-- ----------------------------------------------------------------------------

create index orders_brand_placed_idx   on orders (brand_id, placed_at desc);
create index orders_status_idx         on orders (status);
create index order_lines_order_idx     on order_lines (order_id);
create index movements_prod_loc_idx    on stock_movements (product_id, location_id, created_at);
create index webhook_events_status_idx on webhook_events (status) where status in ('failed','received');
create index listings_lookup_idx       on channel_listings (channel_id, external_sku) where active;
create index findings_run_idx          on reconciliation_findings (run_id);
