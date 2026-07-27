-- ============================================================================
-- COMMERCE OS — Reorder signals + replenishment view (Migration 010)
--
-- Module 1 M1-C. Turns the ledger's sell-through history into buying
-- decisions:
--
--   • `compute_reorder_signals(location_id, brand_id?)` — SQL function
--     returning per-product recommendations (current available, daily
--     velocity, days-of-cover, recommended reorder qty, primary supplier,
--     urgency).
--   • `replenishment_alerts` view — same shape, only urgency != 'ok'.
--   • `upsert_reorder_point` — small RPC the settings UI calls to save
--     thresholds.
--
-- Urgency levels: 'ok' | 'watch' | 'reorder' | 'expedite' — driven by
-- days-of-cover vs. supplier lead time.
-- ============================================================================

create or replace function compute_reorder_signals(
  p_location_id uuid,
  p_brand_id    uuid default null
) returns table (
  product_id           uuid,
  sku                  text,
  title                text,
  brand_id             uuid,
  brand_name           text,
  location_id          uuid,
  location_name        text,
  on_hand              integer,
  committed            integer,
  available            integer,
  min_qty              integer,
  target_qty           integer,
  velocity_window      interval,
  units_shipped_window integer,
  velocity_per_day     numeric,
  days_of_cover        numeric,
  primary_supplier_id  uuid,
  primary_supplier_name text,
  primary_unit_cost_cents integer,
  primary_lead_time_days integer,
  primary_moq          integer,
  recommended_qty      integer,
  urgency              text
) language sql as $$
  with product_scope as (
    select p.id, p.sku, p.title, p.brand_id, b.name as brand_name
      from products p
      join brands b on b.id = p.brand_id
     where p_brand_id is null or p.brand_id = p_brand_id
  ),
  levels as (
    select sl.product_id, sl.location_id, l.name as location_name,
           sl.on_hand, sl.committed,
           (sl.on_hand - sl.committed) as available
      from stock_levels sl
      join locations l on l.id = sl.location_id
     where sl.location_id = p_location_id
  ),
  rp as (
    select rp.product_id, rp.location_id, rp.min_qty, rp.target_qty, rp.velocity_window
      from reorder_points rp
     where rp.location_id = p_location_id
  ),
  velocity as (
    -- shipments are -qty; abs() gives units shipped
    select
      sm.product_id,
      abs(sum(sm.qty_delta))::integer as units_shipped_window,
      coalesce(rp2.velocity_window, interval '30 days') as window
      from stock_movements sm
      left join rp as rp2 on rp2.product_id = sm.product_id
     where sm.reason = 'order_shipment'
       and sm.location_id = p_location_id
       and sm.created_at > now() - coalesce(rp2.velocity_window, interval '30 days')
     group by sm.product_id, rp2.velocity_window
  ),
  primary_sup as (
    select sp.product_id, sp.supplier_id, s.name as supplier_name,
           sp.unit_cost_cents, sp.lead_time_days, sp.moq
      from supplier_products sp
      join suppliers s on s.id = sp.supplier_id
     where sp.is_primary
  )
  select
    ps.id,
    ps.sku,
    ps.title,
    ps.brand_id,
    ps.brand_name,
    p_location_id,
    lv.location_name,
    coalesce(lv.on_hand, 0),
    coalesce(lv.committed, 0),
    coalesce(lv.available, 0),
    rp.min_qty,
    rp.target_qty,
    coalesce(rp.velocity_window, interval '30 days'),
    coalesce(v.units_shipped_window, 0),
    case
      when coalesce(v.units_shipped_window, 0) = 0 then 0
      else round(v.units_shipped_window::numeric
                / extract(epoch from coalesce(rp.velocity_window, interval '30 days')) * 86400, 2)
    end,
    case
      when coalesce(v.units_shipped_window, 0) = 0 or lv.available is null then null
      else round(
        lv.available::numeric
        / (v.units_shipped_window::numeric
           / extract(epoch from coalesce(rp.velocity_window, interval '30 days')) * 86400),
        1)
    end,
    pri.supplier_id,
    pri.supplier_name,
    pri.unit_cost_cents,
    pri.lead_time_days,
    pri.moq,
    case
      when rp.target_qty is null then null
      else greatest(
        rp.target_qty - coalesce(lv.available, 0),
        coalesce(pri.moq, 1)
      )
    end,
    case
      when coalesce(v.units_shipped_window, 0) = 0 then 'ok'
      when rp.min_qty is not null
           and coalesce(lv.available, 0) <= rp.min_qty
        then 'expedite'
      when pri.lead_time_days is not null
           and v.units_shipped_window > 0
           and (
             lv.available::numeric
             / (v.units_shipped_window::numeric
                / extract(epoch from coalesce(rp.velocity_window, interval '30 days')) * 86400)
           ) < pri.lead_time_days
        then 'reorder'
      when rp.target_qty is not null
           and coalesce(lv.available, 0) < rp.target_qty
        then 'watch'
      else 'ok'
    end
  from product_scope ps
  left join levels lv    on lv.product_id = ps.id
  left join rp           on rp.product_id = ps.id
  left join velocity v   on v.product_id  = ps.id
  left join primary_sup pri on pri.product_id = ps.id;
$$;

create or replace view replenishment_alerts as
select *
  from compute_reorder_signals(
    (select id from locations where name = 'Van Nuys DC' limit 1),
    null
  )
 where urgency <> 'ok';

create or replace function upsert_reorder_point(
  p_product_id uuid,
  p_location_id uuid,
  p_min_qty integer,
  p_target_qty integer,
  p_velocity_window interval default interval '30 days'
) returns jsonb
language plpgsql as $$
begin
  if p_min_qty < 0 or p_target_qty < p_min_qty then
    raise exception 'upsert_reorder_point: min_qty must be non-negative and <= target_qty';
  end if;

  insert into reorder_points
    (product_id, location_id, min_qty, target_qty, velocity_window)
    values (p_product_id, p_location_id, p_min_qty, p_target_qty, p_velocity_window)
    on conflict (product_id, location_id)
    do update set
      min_qty         = excluded.min_qty,
      target_qty      = excluded.target_qty,
      velocity_window = excluded.velocity_window,
      updated_at      = now();

  return jsonb_build_object(
    'outcome',    'saved',
    'product_id', p_product_id,
    'location_id', p_location_id
  );
end $$;

grant select on replenishment_alerts to service_role;
grant execute on function
  compute_reorder_signals(uuid, uuid),
  upsert_reorder_point(uuid, uuid, integer, integer, interval)
to service_role;
