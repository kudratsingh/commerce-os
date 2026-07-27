-- ============================================================================
-- COMMERCE OS — Margin snapshot on ship (Migration 011)
--
-- Module 1 M1-D. Every time an order ships, a margin_snapshots row lands
-- for each line: gross_revenue, marketplace fee (from time-versioned
-- fee_schedules), landed cost (average of recent landings — FIFO is
-- ADR-009 territory in M1-E). All integer cents.
--
-- The snapshot writes are inside `ship_order` (redefined here) so they
-- commit atomically with the ledger and rollup updates.
-- ============================================================================

create or replace function _fee_for_line(
  p_channel_id text,
  p_product_id uuid,
  p_brand_id uuid,
  p_gross_cents bigint,
  p_at timestamptz
) returns bigint
language sql as $$
  select
    coalesce(
      (p_gross_cents * fs.fee_pct_bps / 10000) + fs.fee_flat_cents,
      0
    )::bigint
    from fee_schedules fs
   where fs.channel_id = p_channel_id
     and fs.effective_from <= p_at
     and (fs.effective_until is null or fs.effective_until > p_at)
     and (fs.product_id is null or fs.product_id = p_product_id)
     and (fs.brand_id is null   or fs.brand_id   = p_brand_id)
   order by
     (case when fs.product_id is not null then 0 else 1 end),
     (case when fs.brand_id   is not null then 0 else 1 end),
     fs.effective_from desc
   limit 1;
$$;

create or replace function _avg_landed_unit(p_product_id uuid)
returns bigint language sql as $$
  select coalesce(
    (select round(avg(landed_unit_cents))::bigint
       from landed_costs
      where product_id = p_product_id
        and received_at > now() - interval '365 days'),
    (select cost_cents::bigint from products where id = p_product_id),
    0
  );
$$;

create or replace function _write_margin_snapshot(p_order_line_id uuid)
returns void
language plpgsql as $$
declare
  v_order_id      uuid;
  v_product_id    uuid;
  v_qty           integer;
  v_unit_price    integer;
  v_channel_id    text;
  v_brand_id      uuid;
  v_placed_at     timestamptz;
  v_gross         bigint;
  v_fee           bigint;
  v_landed        bigint;
begin
  select ol.order_id, ol.product_id, ol.qty, ol.unit_price_cents
    into v_order_id, v_product_id, v_qty, v_unit_price
    from order_lines ol
    where ol.id = p_order_line_id;

  if v_order_id is null then
    return;
  end if;

  select o.channel_id, o.brand_id, o.placed_at
    into v_channel_id, v_brand_id, v_placed_at
    from orders o
    where o.id = v_order_id;

  v_gross  := (v_qty::bigint) * (v_unit_price::bigint);
  v_fee    := _fee_for_line(v_channel_id, v_product_id, v_brand_id, v_gross, v_placed_at);
  v_landed := _avg_landed_unit(v_product_id) * v_qty;

  insert into margin_snapshots
    (order_id, order_line_id, gross_revenue_cents, fee_cents, landed_cost_cents)
    values (v_order_id, p_order_line_id, v_gross, v_fee, v_landed)
    on conflict (order_line_id) do nothing;
end $$;

-- ship_order redefined to call _write_margin_snapshot per line
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
    select ol.id, ol.product_id, ol.qty
    from order_lines ol
    where ol.order_id = p_order_id
    order by ol.product_id
  loop
    update stock_levels
       set on_hand   = on_hand   - line.qty,
           committed = committed - line.qty
     where product_id = line.product_id
       and location_id = p_location_id;

    insert into stock_movements
      (product_id, location_id, qty_delta, reason, ref_type, ref_id)
      values (line.product_id, p_location_id, -line.qty,
              'order_shipment', 'order', p_order_id);

    -- M1-D: capture margin at ship time
    perform _write_margin_snapshot(line.id);
  end loop;

  update orders set status = 'shipped' where id = p_order_id;
end $$;

grant execute on function _write_margin_snapshot(uuid) to service_role;
grant execute on function _fee_for_line(text, uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function _avg_landed_unit(uuid) to service_role;

-- Bootstrap default fee schedule per channel so M1-D margin math has
-- something to compute against on a fresh reset. Real ops replace these
-- via the /settings/fees editor.
insert into fee_schedules (channel_id, fee_pct_bps, fee_flat_cents)
select id, 800, 30
  from channels
 where not exists (
   select 1 from fee_schedules fs where fs.channel_id = channels.id
 );
