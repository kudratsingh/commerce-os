-- ============================================================================
-- COMMERCE OS — Ingestion pipeline (Migration 003)
--
-- Adds the atomic ingestion function `process_order_event` plus the outbox
-- sweeper helpers. Everything the webhook route needs to do — dedupe, upsert,
-- allocate, outbox write, event bookkeeping — lands in one DB round trip so
-- the guarantees from ADR-001 through ADR-004 apply without app-layer heroics.
--
-- Also registers `orders`, `order_lines`, `stock_levels`, `webhook_events`,
-- and `outbox` in the `supabase_realtime` publication so the Day-3 dashboard
-- can subscribe. Guarded so this migration also runs on a bare Postgres 16
-- container (our CI) that has no Supabase Realtime installed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema addition: last_error on outbox
--    (additive column; needed so failed deliveries carry an explainable reason
--    into the DLQ panel without a second table)
-- ----------------------------------------------------------------------------

alter table outbox add column if not exists last_error text;

-- ----------------------------------------------------------------------------
-- 2. process_order_event — the whole ingestion pipeline as one function
--
-- Contract:
--   in  : channel, external_event_id, event_type, payload, signature_valid,
--         target location
--   out : jsonb { outcome, event_id?, order_id?, reason? }
--
-- outcomes:
--   'deduped'      — event_id was already seen (200 to marketplace)
--   'bad_signature'— HMAC failed at the route; recorded as 'dead' here
--   'allocated'    — order upserted, stock reserved
--   'backordered'  — insufficient stock; committed unchanged (ADR-001)
--   'cancelled'    — cancellation applied, reservation released if any
--   'failed'       — reserved for any other error; row goes to DLQ (status
--                    = 'failed'), attempts++, last_error set; safe to retry
--
-- The inner BEGIN…EXCEPTION block gives us all-or-nothing domain semantics
-- while preserving the webhook_events row + its status update in the outer
-- transaction — the DLQ shows the failure with the payload, ready for retry.
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
  -- (a) event-level dedupe — the ADR-004 gate
  insert into webhook_events
    (channel_id, external_event_id, event_type, payload, signature_valid)
    values
    (p_channel_id, p_external_event_id, p_event_type, p_payload, p_signature_valid)
    on conflict (channel_id, external_event_id) do nothing
    returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'deduped');
  end if;

  -- (b) refuse to process an unsigned payload, but record the attempt
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

  -- (c) domain work in a nested block so a failure here rolls back only
  --     the order/allocation/outbox writes, leaving the event row + a
  --     visible 'failed' status for the DLQ.
  begin
    if p_event_type = 'order.created' then
      select outcome, order_id
        into v_status, v_order_id
        from _apply_order_created(p_payload, p_channel_id, p_location_id);

    elsif p_event_type = 'order.cancelled' then
      select outcome, order_id
        into v_status, v_order_id
        from _apply_order_cancelled(p_payload, p_channel_id, p_location_id);

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
-- 3. _apply_order_created — order upsert, line resolution, allocation, outbox
--    Underscore prefix = internal helper, called only by process_order_event.
--    Returns (outcome, order_id) where outcome is 'allocated' | 'backordered'.
--
-- Order-level idempotency: the ON CONFLICT DO NOTHING on
-- (channel_id, external_order_id) makes a second delivery of the same order
-- (even under a fresh event_id) a no-op — we look up the existing status and
-- return it, so the route still 200s and the marketplace stops retrying.
-- ----------------------------------------------------------------------------

create or replace function _apply_order_created(
  p_payload    jsonb,
  p_channel_id text,
  p_location_id uuid
) returns table (outcome text, order_id uuid)
language plpgsql as $$
declare
  v_order_id       uuid;
  v_external_order text;
  v_brand_id       uuid;
  v_placed_at      timestamptz;
  v_buyer          text;
  v_subtotal       integer := 0;
  v_line           jsonb;
  v_product_id     uuid;
  v_status         text;
  v_existing       text;
begin
  v_external_order := p_payload->'order'->>'external_order_id';
  v_placed_at      := (p_payload->'order'->>'placed_at')::timestamptz;
  v_buyer          := p_payload->'order'->>'buyer_handle';

  if v_external_order is null then
    raise exception 'payload missing order.external_order_id';
  end if;

  -- resolve every line's product first so we fail before writing anything
  for v_line in select jsonb_array_elements(p_payload->'order'->'lines')
  loop
    select p.id, p.brand_id
      into v_product_id, v_brand_id
      from channel_listings cl
      join products p on p.id = cl.product_id
     where cl.channel_id   = p_channel_id
       and cl.external_sku = v_line->>'external_sku'
       and cl.active;

    if v_product_id is null then
      raise exception 'unknown external_sku "%" on channel %',
        v_line->>'external_sku', p_channel_id;
    end if;

    v_subtotal := v_subtotal + ((v_line->>'qty')::int * (v_line->>'unit_price_cents')::int);
  end loop;

  -- order-level idempotency: DO NOTHING and detect it via missing RETURNING
  insert into orders
    (brand_id, channel_id, external_order_id, buyer_handle,
     subtotal_cents, placed_at, raw_payload)
    values
    (v_brand_id, p_channel_id, v_external_order, v_buyer,
     v_subtotal, v_placed_at, p_payload)
    on conflict (channel_id, external_order_id) do nothing
    returning id into v_order_id;

  -- already-processed order (different event_id, same order): no re-allocate
  if v_order_id is null then
    select id, status
      into v_order_id, v_existing
      from orders
     where channel_id = p_channel_id
       and external_order_id = v_external_order;
    return query select v_existing, v_order_id;
    return;
  end if;

  -- write lines
  for v_line in select jsonb_array_elements(p_payload->'order'->'lines')
  loop
    select p.id into v_product_id
      from channel_listings cl
      join products p on p.id = cl.product_id
     where cl.channel_id   = p_channel_id
       and cl.external_sku = v_line->>'external_sku'
       and cl.active;

    insert into order_lines (order_id, product_id, qty, unit_price_cents)
      values (v_order_id, v_product_id,
              (v_line->>'qty')::int,
              (v_line->>'unit_price_cents')::int);
  end loop;

  -- allocate (the CHECK firewall lives in stock_levels; this returns
  -- 'allocated' or 'backordered' per ADR-001)
  select allocate_order(v_order_id, p_location_id) into v_status;

  insert into outbox (aggregate_type, aggregate_id, event_type, payload)
    values ('order', v_order_id, 'order.' || v_status,
            jsonb_build_object(
              'order_id', v_order_id,
              'channel_id', p_channel_id,
              'external_order_id', v_external_order,
              'status', v_status));

  return query select v_status, v_order_id;
end $$;

-- ----------------------------------------------------------------------------
-- 4. _apply_order_cancelled — release the reservation, outbox
-- ----------------------------------------------------------------------------

create or replace function _apply_order_cancelled(
  p_payload    jsonb,
  p_channel_id text,
  p_location_id uuid
) returns table (outcome text, order_id uuid)
language plpgsql as $$
declare
  v_order_id       uuid;
  v_external_order text;
begin
  v_external_order := p_payload->'order'->>'external_order_id';

  if v_external_order is null then
    raise exception 'payload missing order.external_order_id';
  end if;

  select id into v_order_id
    from orders
   where channel_id = p_channel_id
     and external_order_id = v_external_order;

  -- cancel-before-create: raise so the event goes to DLQ and can be retried
  -- once the create webhook arrives.
  if v_order_id is null then
    raise exception 'cannot cancel unknown order % on channel %',
      v_external_order, p_channel_id;
  end if;

  perform cancel_order(v_order_id, p_location_id);

  insert into outbox (aggregate_type, aggregate_id, event_type, payload)
    values ('order', v_order_id, 'order.cancelled',
            jsonb_build_object(
              'order_id', v_order_id,
              'channel_id', p_channel_id,
              'external_order_id', v_external_order));

  return query select 'cancelled'::text, v_order_id;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Outbox sweeper — atomic claim via SKIP LOCKED
--
-- The Workers Cron Trigger (1/min, may overlap) calls this. Delivery is a
-- no-op for the demo — every "and then notify/sync" is represented by the
-- row itself + the JSON payload the caller receives. When a real downstream
-- lands (Slack, marketplace ack, analytics), the caller does the work per
-- returned row and calls outbox_mark_failed on any that error out.
-- ----------------------------------------------------------------------------

create or replace function outbox_deliver_batch(p_limit int default 50)
returns table (id bigint, event_type text, aggregate_id uuid, payload jsonb)
language sql as $$
  update outbox
     set status = 'delivered',
         delivered_at = now()
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

create or replace function outbox_mark_failed(
  p_id bigint,
  p_error text,
  p_max_attempts int default 6
) returns text
language plpgsql as $$
declare
  v_attempts int;
  v_status   text;
begin
  update outbox
     set attempts = attempts + 1,
         last_error = p_error
   where id = p_id
   returning attempts into v_attempts;

  if v_attempts >= p_max_attempts then
    v_status := 'dead';
    update outbox set status = 'dead' where id = p_id;
  else
    v_status := 'failed';
    update outbox
       set status = 'failed',
           -- exponential backoff, capped at ~64 min (2^6)
           next_attempt_at = now() + (least(power(2, v_attempts), 64)::text || ' minutes')::interval
     where id = p_id;
  end if;

  return v_status;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Realtime publication — Day 3 dashboard needs push, not poll
--
-- Guarded so this migration also applies on a bare Postgres 16 that doesn't
-- have supabase_realtime pre-created (our CI container). On real Supabase,
-- the publication already exists and we just add the tables.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_lines', 'stock_levels', 'webhook_events', 'outbox']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Indexes for the hottest new access paths
-- ----------------------------------------------------------------------------

create index if not exists webhook_events_recv_idx   on webhook_events (received_at desc);
create index if not exists outbox_created_idx        on outbox (created_at desc);
create index if not exists orders_channel_ext_idx    on orders (channel_id, external_order_id);

-- ----------------------------------------------------------------------------
-- 8. PostgREST grants
--
-- Supabase's new cloud default no longer auto-exposes public tables to the
-- Data API roles (see the `auto_expose_new_tables` note in config.toml). We
-- grant explicitly so migration 001's tables show up over PostgREST for the
-- service role (server-side) — the future per-brand portal will add narrower
-- anon/authenticated grants alongside RLS policies.
-- ----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables    in schema public to service_role;
grant usage,   select                on all sequences in schema public to service_role;
grant execute                        on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
