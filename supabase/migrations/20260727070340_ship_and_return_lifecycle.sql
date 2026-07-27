-- ============================================================================
-- COMMERCE OS — Ship + return lifecycle (Migration 007)
--
-- Interview brief item B: the ledger has the vocabulary for shipments and
-- returns (`ship_order` from migration 001; `return_received` in the ledger
-- reason enum) but ingestion only accepted `order.created` and
-- `order.cancelled`. That means:
--
--   • Nothing ever shipped through webhooks — `on_hand` only ever went up.
--   • Nothing ever returned — a returned unit going back on shelf was a
--     `stock_movement` we couldn't write.
--
-- This migration wires both:
--
--   • `process_order_event` gains dispatch for `order.shipped` and
--     `order.returned`.
--   • `_apply_order_shipped` looks up the order and calls the existing
--     `ship_order` RPC, then writes to outbox. Refuses to ship anything
--     that isn't currently `allocated` (invariant: only allocated stock
--     can leave the door).
--   • `_apply_order_returned` writes a `return_received` movement (+qty),
--     increments `stock_levels.on_hand`, transitions the order to a new
--     status `returned`. Refuses to return an order that never shipped.
--
-- `dashboard_summary` gets `shipped_count` and `returned_count` today.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add `returned` as a valid order status
--
--    The migration-001 check constraint had 7 valid statuses. `returned` is
--    the eighth. Drop + recreate the constraint — no data loss since no
--    existing rows use the new value.
-- ----------------------------------------------------------------------------

alter table orders drop constraint orders_status_check;

alter table orders add constraint orders_status_check
  check (status in ('received','allocated','backordered',
                    'shipped','delivered','cancelled','refunded','returned'));

-- ----------------------------------------------------------------------------
-- 2. _apply_order_shipped
--
--    Idempotent: shipping an order that's already shipped returns 'shipped'
--    without calling `ship_order` a second time (which would write duplicate
--    ledger entries and negatively double-decrement stock_levels).
-- ----------------------------------------------------------------------------

create or replace function _apply_order_shipped(
  p_payload    jsonb,
  p_channel_id text,
  p_location_id uuid
) returns table (outcome text, order_id uuid)
language plpgsql as $$
declare
  v_order_id       uuid;
  v_external_order text;
  v_status         text;
begin
  v_external_order := p_payload->'order'->>'external_order_id';

  if v_external_order is null then
    raise exception 'payload missing order.external_order_id';
  end if;

  select id, status
    into v_order_id, v_status
    from orders
   where channel_id = p_channel_id
     and external_order_id = v_external_order;

  if v_order_id is null then
    raise exception 'cannot ship unknown order % on channel %',
      v_external_order, p_channel_id;
  end if;

  -- Idempotent: same order shipped twice = no-op
  if v_status = 'shipped' or v_status = 'delivered' or v_status = 'returned' then
    return query select v_status, v_order_id;
    return;
  end if;

  if v_status <> 'allocated' then
    raise exception 'cannot ship order % (status = %) — only allocated orders can ship',
      v_external_order, v_status;
  end if;

  -- ship_order writes ledger -qty rows AND updates stock_levels
  -- (on_hand -qty, committed -qty). Both in one transaction.
  perform ship_order(v_order_id, p_location_id);

  insert into outbox (aggregate_type, aggregate_id, event_type, payload)
    values ('order', v_order_id, 'order.shipped',
            jsonb_build_object(
              'order_id', v_order_id,
              'channel_id', p_channel_id,
              'external_order_id', v_external_order));

  return query select 'shipped'::text, v_order_id;
end $$;

-- ----------------------------------------------------------------------------
-- 3. _apply_order_returned
--
--    A returned unit is a stock_movement with reason='return_received',
--    qty_delta = +qty per line. `stock_levels.on_hand` moves up by the
--    same amount. This is the physical-goods-back path — money handling
--    (refund vs. store credit) is a Module-5 concern; this migration only
--    represents the physical event.
--
--    Refuses to accept a return for anything that hasn't shipped —
--    otherwise a bad payload could double-count inventory.
-- ----------------------------------------------------------------------------

create or replace function _apply_order_returned(
  p_payload    jsonb,
  p_channel_id text,
  p_location_id uuid
) returns table (outcome text, order_id uuid)
language plpgsql as $$
declare
  v_order_id       uuid;
  v_external_order text;
  v_status         text;
  line             record;
begin
  v_external_order := p_payload->'order'->>'external_order_id';

  if v_external_order is null then
    raise exception 'payload missing order.external_order_id';
  end if;

  select id, status
    into v_order_id, v_status
    from orders
   where channel_id = p_channel_id
     and external_order_id = v_external_order
   for update;

  if v_order_id is null then
    raise exception 'cannot return unknown order % on channel %',
      v_external_order, p_channel_id;
  end if;

  -- Idempotent: same order returned twice = no-op
  if v_status = 'returned' then
    return query select 'returned'::text, v_order_id;
    return;
  end if;

  if v_status not in ('shipped', 'delivered') then
    raise exception 'cannot return order % (status = %) — only shipped or delivered orders can be returned',
      v_external_order, v_status;
  end if;

  -- Write the physical return: +qty ledger entry per line, on_hand += qty.
  -- Ordered by product_id for the same deadlock-avoidance discipline as
  -- allocate_order.
  for line in
    select ol.product_id, ol.qty
      from order_lines ol
     where ol.order_id = v_order_id
     order by ol.product_id
  loop
    insert into stock_movements
      (product_id, location_id, qty_delta, reason, ref_type, ref_id)
      values (line.product_id, p_location_id, line.qty,
              'return_received', 'order', v_order_id);

    update stock_levels
       set on_hand = on_hand + line.qty
     where product_id  = line.product_id
       and location_id = p_location_id;

    -- If the (product, location) row doesn't exist yet (unusual — returned
    -- unit is for a SKU we don't stock elsewhere at this location), create
    -- it. Committed = 0 because the order was already shipped, so nothing
    -- is reserved for it.
    if not found then
      insert into stock_levels (product_id, location_id, on_hand, committed)
        values (line.product_id, p_location_id, line.qty, 0)
        on conflict (product_id, location_id) do update
          set on_hand = stock_levels.on_hand + excluded.on_hand;
    end if;
  end loop;

  update orders set status = 'returned' where id = v_order_id;

  insert into outbox (aggregate_type, aggregate_id, event_type, payload)
    values ('order', v_order_id, 'order.returned',
            jsonb_build_object(
              'order_id', v_order_id,
              'channel_id', p_channel_id,
              'external_order_id', v_external_order));

  return query select 'returned'::text, v_order_id;
end $$;

-- ----------------------------------------------------------------------------
-- 4. process_order_event — dispatch on the new event types
--
--    Same shape as migration 003; adds two new branches. The whole function
--    body is rewritten so the CASE is coherent (plpgsql doesn't compose
--    branches by superseding function bodies — this is the shortest read).
-- ----------------------------------------------------------------------------

create or replace function process_order_event(
  p_channel_id        text,
  p_external_event_id text,
  p_event_type        text,
  p_payload           jsonb,
  p_signature_valid   boolean,
  p_location_id       uuid
) returns jsonb
language plpgsql as $$
declare
  v_event_id uuid;
  v_order_id uuid;
  v_status   text;
begin
  -- (a) event-level dedupe
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
           last_error = 'invalid HMAC signature'
     where id = v_event_id;
    return jsonb_build_object(
      'outcome', 'bad_signature',
      'event_id', v_event_id
    );
  end if;

  begin
    if p_event_type = 'order.created' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_created(p_payload, p_channel_id, p_location_id);

    elsif p_event_type = 'order.cancelled' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_cancelled(p_payload, p_channel_id, p_location_id);

    elsif p_event_type = 'order.shipped' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_shipped(p_payload, p_channel_id, p_location_id);

    elsif p_event_type = 'order.returned' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_returned(p_payload, p_channel_id, p_location_id);

    else
      raise exception 'unsupported event type: %', p_event_type;
    end if;

    update webhook_events
       set status = 'processed',
           processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'outcome',  v_status,
      'event_id', v_event_id,
      'order_id', v_order_id
    );

  exception when others then
    update webhook_events
       set status = 'failed',
           attempts = attempts + 1,
           last_error = sqlerrm
     where id = v_event_id;
    return jsonb_build_object(
      'outcome',  'failed',
      'event_id', v_event_id,
      'reason',   sqlerrm
    );
  end;
end $$;

-- ----------------------------------------------------------------------------
-- 5. retry_webhook_event — dispatch on the new event types
--
--    Retry has the same limitation: it needs to know how to re-apply the
--    stored payload. Adds two new branches paralleling the ones above.
-- ----------------------------------------------------------------------------

create or replace function retry_webhook_event(
  p_event_id    uuid,
  p_location_id uuid
) returns jsonb
language plpgsql as $$
declare
  v_ev       record;
  v_status   text;
  v_order_id uuid;
begin
  select id, channel_id, event_type, payload, status, signature_valid
    into v_ev
    from webhook_events
    where id = p_event_id
    for update;

  if v_ev.id is null then
    raise exception 'webhook event % not found', p_event_id;
  end if;

  if v_ev.status = 'processed' then
    return jsonb_build_object(
      'outcome',  'already_processed',
      'event_id', p_event_id
    );
  end if;

  if not v_ev.signature_valid then
    return jsonb_build_object(
      'outcome',  'refused',
      'event_id', p_event_id,
      'reason',   'cannot retry an event with invalid signature — investigate the source'
    );
  end if;

  begin
    if v_ev.event_type = 'order.created' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_created(v_ev.payload, v_ev.channel_id, p_location_id);
    elsif v_ev.event_type = 'order.cancelled' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_cancelled(v_ev.payload, v_ev.channel_id, p_location_id);
    elsif v_ev.event_type = 'order.shipped' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_shipped(v_ev.payload, v_ev.channel_id, p_location_id);
    elsif v_ev.event_type = 'order.returned' then
      select outcome, order_id into v_status, v_order_id
        from _apply_order_returned(v_ev.payload, v_ev.channel_id, p_location_id);
    else
      raise exception 'cannot retry unsupported event type: %', v_ev.event_type;
    end if;

    update webhook_events
       set status       = 'processed',
           processed_at = now(),
           last_error   = null
     where id = p_event_id;

    return jsonb_build_object(
      'outcome',  v_status,
      'event_id', p_event_id,
      'order_id', v_order_id
    );

  exception when others then
    update webhook_events
       set status     = 'failed',
           attempts   = attempts + 1,
           last_error = sqlerrm
     where id = p_event_id;
    return jsonb_build_object(
      'outcome',  'failed',
      'event_id', p_event_id,
      'reason',   sqlerrm
    );
  end;
end $$;

-- ----------------------------------------------------------------------------
-- 6. dashboard_summary — surface shipped + returned counters today
--
--    Reads gain two columns: shipped_count (orders whose CURRENT status is
--    'shipped' or 'delivered') and returned_count (status='returned'). Both
--    today-only per the placed_at filter.
--
--    Postgres' CREATE OR REPLACE VIEW can't change column names or order,
--    so we DROP + CREATE. Safe: no persisted data in a view; the app reads
--    the view name, not a column reference.
-- ----------------------------------------------------------------------------

drop view if exists dashboard_summary;

create view dashboard_summary as
with today as (
  select
    coalesce(sum(subtotal_cents), 0)::bigint         as gmv_cents,
    count(*)                                         as orders_count,
    count(*) filter (where status = 'backordered')   as backordered_count,
    count(*) filter (where status in ('shipped','delivered')) as shipped_count,
    count(*) filter (where status = 'returned')      as returned_count
  from orders
  where placed_at >= date_trunc('day', now() at time zone 'utc')
    and status not in ('cancelled', 'refunded')
),
counters as (
  select * from ingestion_counters_today
),
dlq as (
  select count(*) as dlq_count from webhook_events where status in ('failed','dead')
)
select
  today.gmv_cents,
  today.orders_count,
  today.backordered_count,
  today.shipped_count,
  today.returned_count,
  counters.received_count,
  counters.processed_count,
  counters.failed_count,
  counters.dead_count,
  dlq.dlq_count
from today, counters, dlq;

grant select on dashboard_summary to service_role;

-- ----------------------------------------------------------------------------
-- 7. recent_orders — no schema change, but comment for the reader:
--    the new statuses ('returned') automatically flow through since the
--    view selects `status` verbatim.
-- ----------------------------------------------------------------------------
