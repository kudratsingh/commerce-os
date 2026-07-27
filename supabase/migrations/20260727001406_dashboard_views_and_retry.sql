-- ============================================================================
-- COMMERCE OS — Dashboard read models + DLQ retry (Migration 004)
--
-- Day-3 lands the ops dashboard. Every number on the page needs to trace
-- back to a view you can name in the demo. This migration adds those views
-- (stock_dashboard, dlq_events, ingestion_counters_today, dashboard_summary,
-- recent_orders) plus the retry_webhook_event RPC that the DLQ panel calls
-- per row.
--
-- All time boundaries are UTC (invariant #9); the app formats for the viewer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. stock_dashboard — the "what's on the floor" read model
--
--    Rolls up per product+location so the dashboard doesn't need to join
--    products / brands / locations client-side. `available` is derived; the
--    `low_stock` flag is a fixed 20-unit threshold for the demo — real ops
--    would base this on velocity (per Module 1 in ROADMAP.md).
-- ----------------------------------------------------------------------------

create or replace view stock_dashboard as
select
  p.id                              as product_id,
  p.sku,
  p.title,
  b.id                              as brand_id,
  b.name                            as brand_name,
  sl.location_id,
  l.name                            as location_name,
  sl.on_hand,
  sl.committed,
  (sl.on_hand - sl.committed)       as available,
  ((sl.on_hand - sl.committed) <= 20) as low_stock,
  p.price_cents,
  p.cost_cents
from stock_levels sl
join products  p on p.id = sl.product_id
join brands    b on b.id = p.brand_id
join locations l on l.id = sl.location_id;

-- ----------------------------------------------------------------------------
-- 2. dlq_events — everything an operator needs to triage in one query
--
--    Combines status = 'failed' (retryable) and 'dead' (bad signature or
--    max-attempts hit). Extracts the external_order_id from the payload
--    when present so the DLQ panel can link to the corresponding order.
-- ----------------------------------------------------------------------------

create or replace view dlq_events as
select
  we.id,
  we.channel_id,
  we.external_event_id,
  we.event_type,
  we.status,
  we.signature_valid,
  we.attempts,
  we.last_error,
  we.received_at,
  we.processed_at,
  we.payload,
  we.payload -> 'order' ->> 'external_order_id' as external_order_id
from webhook_events we
where we.status in ('failed', 'dead')
order by we.received_at desc;

-- ----------------------------------------------------------------------------
-- 3. ingestion_counters_today — the stat-card totals
--
--    Received / processed / deduped / failed / dead for the current UTC day.
--    Powers the top-of-dashboard counter strip — Day 4's chaos panel will
--    reuse it verbatim.
-- ----------------------------------------------------------------------------

create or replace view ingestion_counters_today as
select
  count(*) filter (where status = 'received')  as received_count,
  count(*) filter (where status = 'processed') as processed_count,
  count(*) filter (where status = 'failed')    as failed_count,
  count(*) filter (where status = 'dead')      as dead_count,
  count(*)                                     as total_count
from webhook_events
where received_at >= date_trunc('day', now() at time zone 'utc');

-- ----------------------------------------------------------------------------
-- 4. dashboard_summary — one row of top-of-page totals for SSR
--
--    Cheap to fetch (single row), cheap to render. Combines GMV, order
--    count, dedupe/DLQ counts into one query so the dashboard's initial
--    HTML is one round-trip.
-- ----------------------------------------------------------------------------

create or replace view dashboard_summary as
with today as (
  select
    coalesce(sum(subtotal_cents), 0)::bigint         as gmv_cents,
    count(*)                                         as orders_count,
    count(*) filter (where status = 'backordered')   as backordered_count
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
  counters.received_count,
  counters.processed_count,
  counters.failed_count,
  counters.dead_count,
  dlq.dlq_count
from today, counters, dlq;

-- ----------------------------------------------------------------------------
-- 5. recent_orders — feed initial page, then Realtime takes over
-- ----------------------------------------------------------------------------

create or replace view recent_orders as
select
  o.id,
  o.channel_id,
  o.external_order_id,
  o.status,
  o.buyer_handle,
  o.subtotal_cents,
  o.placed_at,
  o.created_at,
  o.brand_id,
  b.name as brand_name
from orders o
join brands b on b.id = o.brand_id;

-- ----------------------------------------------------------------------------
-- 6. retry_webhook_event — the "human fixed the cause, machine finishes"
--
--    The DLQ panel calls this per row. Re-runs the domain block from
--    migration 003 (_apply_order_created / _apply_order_cancelled) on the
--    stored payload. On success, flips event to 'processed'; on failure,
--    increments attempts and updates last_error. Bad-signature 'dead' rows
--    are refused — those need root cause, not another try.
--
--    Note: we deliberately do NOT touch the webhook_events unique
--    constraint. The event stays in place; only its status column moves.
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
      select outcome, order_id
        into v_status, v_order_id
        from _apply_order_created(v_ev.payload, v_ev.channel_id, p_location_id);
    elsif v_ev.event_type = 'order.cancelled' then
      select outcome, order_id
        into v_status, v_order_id
        from _apply_order_cancelled(v_ev.payload, v_ev.channel_id, p_location_id);
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
-- 7. PostgREST view grants
--    Views inherit table grants but need explicit privileges. Service role
--    reads them from server components.
-- ----------------------------------------------------------------------------

grant select on stock_dashboard, dlq_events, ingestion_counters_today,
                dashboard_summary, recent_orders
  to service_role;

grant execute on function retry_webhook_event(uuid, uuid) to service_role;
