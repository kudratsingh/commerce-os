-- ============================================================================
-- COMMERCE OS — Purchasing + Margin schema (Migration 008)
--
-- ROADMAP Module 1, PR M1-A. Foundation for the "kill the manual receiving
-- ledger" and "true P&L per SKU per channel" stories. See
-- docs/next-phases/01-purchasing-replenishment.md for the module plan.
--
-- Everything additive. New tables get RLS enabled without policies — this
-- is a deliberate phase gate (writes for anon key don't work until Module 3
-- ships explicit policies). service_role bypasses RLS as usual for the ops
-- dashboard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. suppliers — buy-side counterparties
--
--    Migration 001's `purchase_orders.supplier` is free text. This
--    normalizes it. Backfill happens further down.
-- ----------------------------------------------------------------------------

create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_email text,
  contact_phone text,
  currency      char(3) not null default 'USD',
  notes         text,
  created_at    timestamptz not null default now()
);

alter table suppliers enable row level security;

-- ----------------------------------------------------------------------------
-- 2. supplier_products — per-supplier catalog: what a supplier sells us at
--    what unit cost + lead time. One product can have multiple suppliers.
--
--    is_primary + partial unique index enforces "exactly one primary
--    supplier per product" without an app-layer check.
-- ----------------------------------------------------------------------------

create table supplier_products (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references suppliers(id),
  product_id      uuid not null references products(id),
  supplier_sku    text,
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  moq             integer not null default 1 check (moq > 0),
  lead_time_days  integer not null check (lead_time_days >= 0),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create unique index one_primary_supplier_per_product
  on supplier_products (product_id) where is_primary;

alter table supplier_products enable row level security;

-- ----------------------------------------------------------------------------
-- 3. reorder_points — per-product-per-location threshold + policy
--
--    Not per-supplier — reorder is about "should we buy?" not "who from?".
--    velocity_window is used by compute_reorder_signals (M1-C) to decide
--    how much history the recommendation should look at.
-- ----------------------------------------------------------------------------

create table reorder_points (
  product_id      uuid not null references products(id),
  location_id     uuid not null references locations(id),
  min_qty         integer not null check (min_qty >= 0),
  target_qty      integer not null check (target_qty >= min_qty),
  velocity_window interval not null default interval '30 days',
  auto_generated  boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (product_id, location_id)
);

alter table reorder_points enable row level security;

-- ----------------------------------------------------------------------------
-- 4. fee_schedules — per-channel-per-product marketplace fee model
--
--    Linear model: fee_cents = (subtotal * fee_pct_bps / 10000) + fee_flat_cents.
--    Nulls in product_id + brand_id mean "channel default." Category is an
--    optional facet for future per-category overrides (Amazon-style).
--    effective_from/until = time-versioned; the app reads the "current"
--    schedule as of a given order.placed_at.
--
--    Basis points (bps) chosen over percent floats: 250 bps = 2.5%. Integer
--    everywhere near money (invariant #5).
-- ----------------------------------------------------------------------------

create table fee_schedules (
  id              uuid primary key default gen_random_uuid(),
  channel_id      text not null references channels(id),
  product_id      uuid references products(id),
  brand_id        uuid references brands(id),
  category        text,
  fee_pct_bps     integer not null check (fee_pct_bps >= 0),
  fee_flat_cents  integer not null default 0 check (fee_flat_cents >= 0),
  effective_from  timestamptz not null default now(),
  effective_until timestamptz,
  created_at      timestamptz not null default now()
);

-- Latest-effective wins per (channel, product?, brand?, category?). No unique
-- constraint yet — we let history stack; readers pick the newest row that
-- matches the order's placed_at.
create index fee_schedules_lookup on fee_schedules
  (channel_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
   effective_from desc);

alter table fee_schedules enable row level security;

-- ----------------------------------------------------------------------------
-- 5. landed_costs — denormalized "what a unit COST US" per receipt
--
--    Enables true margin without re-computing at report time. `landed_unit_cents`
--    is a generated column so the sum stays consistent; the components stay
--    queryable individually for "why was Nov 12's receipt 40% pricier?".
--
--    FIFO by received_at is the accounting policy — the receipt that lands
--    first is the first one consumed by a shipment (ADR-009 lands in M1-E).
-- ----------------------------------------------------------------------------

create table landed_costs (
  id                uuid primary key default gen_random_uuid(),
  receipt_id        uuid not null references receipts(id),
  product_id        uuid not null references products(id),
  qty               integer not null check (qty > 0),
  unit_cost_cents   integer not null check (unit_cost_cents >= 0),
  duties_cents      integer not null default 0 check (duties_cents >= 0),
  freight_cents     integer not null default 0 check (freight_cents >= 0),
  handling_cents    integer not null default 0 check (handling_cents >= 0),
  landed_unit_cents integer generated always as
    (unit_cost_cents + duties_cents + freight_cents + handling_cents) stored,
  received_at       timestamptz not null default now()
);

create index landed_costs_by_product on landed_costs (product_id, received_at);

alter table landed_costs enable row level security;

-- ----------------------------------------------------------------------------
-- 6. margin_snapshots — immutable per-order-line profitability snapshot
--
--    Written at ship time (M1-D adds the trigger/consumer). Freezes the
--    fee schedule and landed cost that WERE current when the order shipped,
--    so backdated fee changes never rewrite margin history.
--
--    net_margin_cents is a generated column — the components stay
--    queryable, the roll-up is enforced by the storage.
-- ----------------------------------------------------------------------------

create table margin_snapshots (
  order_id            uuid not null references orders(id),
  order_line_id       uuid not null references order_lines(id),
  gross_revenue_cents bigint not null,
  fee_cents           bigint not null,
  landed_cost_cents   bigint not null,
  net_margin_cents    bigint generated always as
    (gross_revenue_cents - fee_cents - landed_cost_cents) stored,
  computed_at         timestamptz not null default now(),
  primary key (order_line_id)
);

create index margin_snapshots_by_order on margin_snapshots (order_id);

alter table margin_snapshots enable row level security;

-- ----------------------------------------------------------------------------
-- 7. purchase_orders — add supplier_id + backfill
--
--    Existing rows carry `supplier text not null`. We normalize into
--    `suppliers`, add `supplier_id`, backfill via join on name, and drop the
--    NOT NULL from the free-text column so future rows can prefer the FK.
--    Keep the text column for one release cycle for callers we haven't
--    migrated yet — later PR removes it.
-- ----------------------------------------------------------------------------

alter table purchase_orders add column supplier_id uuid references suppliers(id);

-- Backfill: create one suppliers row per distinct free-text supplier name.
insert into suppliers (name, currency)
select distinct supplier, 'USD'
  from purchase_orders
 where supplier is not null
   and supplier <> ''
on conflict (name) do nothing;

update purchase_orders po
   set supplier_id = s.id
  from suppliers s
 where s.name = po.supplier;

-- Relax the NOT NULL so future rows aren't forced to double-write.
alter table purchase_orders alter column supplier drop not null;

create index purchase_orders_supplier_idx on purchase_orders (supplier_id)
  where supplier_id is not null;

-- ----------------------------------------------------------------------------
-- 8. purchase_orders_dashboard — PO list read-model
--
--    Joins to brand + supplier names, aggregates lines and received quantity
--    so the /purchasing list page renders in one query. Days-outstanding is
--    a friendlier field name than raw timestamps.
-- ----------------------------------------------------------------------------

create or replace view purchase_orders_dashboard as
select
  po.id,
  po.brand_id,
  b.name                  as brand_name,
  po.supplier_id,
  coalesce(s.name, po.supplier) as supplier_name,
  po.status,
  po.expected_at,
  po.created_at,
  coalesce(line_agg.line_count, 0)     as line_count,
  coalesce(line_agg.qty_ordered, 0)    as qty_ordered,
  coalesce(line_agg.total_cost_cents, 0)::bigint as total_cost_cents,
  coalesce(recv_agg.qty_received, 0)   as qty_received,
  case
    when coalesce(line_agg.qty_ordered, 0) = 0 then 0
    else coalesce(recv_agg.qty_received, 0)::numeric
       / coalesce(line_agg.qty_ordered, 0)::numeric
  end as receive_fraction,
  extract(epoch from (now() - po.created_at)) / 86400 as days_outstanding
from purchase_orders po
join brands b on b.id = po.brand_id
left join suppliers s on s.id = po.supplier_id
left join (
  select
    pol.purchase_order_id,
    count(*)                       as line_count,
    sum(pol.qty_ordered)           as qty_ordered,
    sum(pol.qty_ordered * pol.unit_cost_cents) as total_cost_cents
    from purchase_order_lines pol
   group by pol.purchase_order_id
) line_agg on line_agg.purchase_order_id = po.id
left join (
  select
    pol.purchase_order_id,
    sum(r.qty_received) as qty_received
    from receipts r
    join purchase_order_lines pol on pol.id = r.purchase_order_line_id
   group by pol.purchase_order_id
) recv_agg on recv_agg.purchase_order_id = po.id;

-- ----------------------------------------------------------------------------
-- 9. sku_margin_by_channel — per-SKU-per-channel margin summary
--
--    Reads margin_snapshots (empty until M1-D wires the trigger). Groups
--    by product+channel over the last 30 days. avg_* columns take bigint
--    for uniformity with source values.
-- ----------------------------------------------------------------------------

create or replace view sku_margin_by_channel as
select
  o.channel_id,
  p.id                            as product_id,
  p.sku,
  p.title,
  b.id                            as brand_id,
  b.name                          as brand_name,
  count(*)                        as orders_in_window,
  avg(ms.gross_revenue_cents)::bigint as avg_gross_revenue_cents,
  avg(ms.fee_cents)::bigint           as avg_fee_cents,
  avg(ms.landed_cost_cents)::bigint   as avg_landed_cost_cents,
  avg(ms.net_margin_cents)::bigint    as avg_net_margin_cents,
  case
    when avg(ms.gross_revenue_cents) > 0
    then round(avg(ms.net_margin_cents)::numeric * 100
             / avg(ms.gross_revenue_cents)::numeric, 2)
    else null
  end                             as net_margin_pct
from margin_snapshots ms
join order_lines ol on ol.id = ms.order_line_id
join orders o       on o.id  = ol.order_id
join products p     on p.id  = ol.product_id
join brands b       on b.id  = p.brand_id
where ms.computed_at > now() - interval '30 days'
group by o.channel_id, p.id, p.sku, p.title, b.id, b.name;

-- ----------------------------------------------------------------------------
-- 10. aged_inventory — capital tied up in stopped-moving SKUs
--
--    days_since_last_shipment defaults to the product's created_at when no
--    shipment has ever occurred (early inventory that never moved). Sorted
--    by dollars_at_risk to point ops at the biggest offenders first.
-- ----------------------------------------------------------------------------

create or replace view aged_inventory as
with last_shipment as (
  select product_id, location_id, max(created_at) as last_shipped_at
    from stock_movements
   where reason = 'order_shipment'
   group by product_id, location_id
),
recent_landed as (
  select
    product_id,
    avg(landed_unit_cents)::bigint as avg_landed_unit_cents
    from landed_costs
   where received_at > now() - interval '365 days'
   group by product_id
)
select
  p.id                                as product_id,
  p.sku,
  p.title,
  b.id                                as brand_id,
  b.name                              as brand_name,
  sl.location_id,
  l.name                              as location_name,
  sl.on_hand,
  ls.last_shipped_at,
  extract(epoch from (now() - coalesce(ls.last_shipped_at, p.created_at))) / 86400
                                      as days_since_last_shipment,
  coalesce(rl.avg_landed_unit_cents, p.cost_cents::bigint) as unit_cost_cents,
  (sl.on_hand::bigint
    * coalesce(rl.avg_landed_unit_cents, p.cost_cents::bigint)) as dollars_at_risk_cents
from stock_levels sl
join products p on p.id = sl.product_id
join brands b   on b.id = p.brand_id
join locations l on l.id = sl.location_id
left join last_shipment ls on ls.product_id = sl.product_id and ls.location_id = sl.location_id
left join recent_landed rl on rl.product_id = sl.product_id
where sl.on_hand > 0;

-- ----------------------------------------------------------------------------
-- 11. landed_cost_history — per-receipt landed cost with joined names
--
--    Feeds the SKU detail chart in M1-D. Filters null-receipt-location just
--    in case landed_costs points at a receipt in a deprecated location.
-- ----------------------------------------------------------------------------

create or replace view landed_cost_history as
select
  lc.id,
  lc.receipt_id,
  lc.product_id,
  p.sku,
  p.title,
  b.name              as brand_name,
  lc.qty,
  lc.unit_cost_cents,
  lc.duties_cents,
  lc.freight_cents,
  lc.handling_cents,
  lc.landed_unit_cents,
  lc.received_at,
  r.location_id,
  loc.name            as location_name
from landed_costs lc
join products p    on p.id  = lc.product_id
join brands b      on b.id  = p.brand_id
join receipts r    on r.id  = lc.receipt_id
join locations loc on loc.id = r.location_id;

-- ----------------------------------------------------------------------------
-- 12. Grants — service_role reads (server-side ops dashboard)
--
--    New tables inherit no grants (Supabase's new default). Explicit grants
--    for service_role only. anon + authenticated grants get added by
--    Module 3's brand portal.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on
  suppliers, supplier_products, reorder_points, fee_schedules,
  landed_costs, margin_snapshots
to service_role;

grant select on
  purchase_orders_dashboard, sku_margin_by_channel, aged_inventory, landed_cost_history
to service_role;
