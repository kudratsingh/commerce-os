-- ============================================================================
-- COMMERCE OS — Demo seed (runs after all migrations on `supabase db reset`)
--
-- Migration 002 stocks the warehouse. This file lays down a demo-day state
-- ON TOP: ~30 orders across the last 3 days, a handful of ships, one cancel,
-- one backorder, two DLQ entries (unknown SKU + cancel-before-create), and
-- one open channel_drift finding. Result: the dashboard has history the
-- moment it opens, and the demo doesn't have to fire anything to look real.
--
-- Everything goes through process_order_event (the real ingestion path), so
-- webhook_events / orders / order_lines / stock_movements / stock_levels /
-- outbox all agree by construction.
-- ============================================================================

do $$
declare
  loc_vannuys uuid;
  v_result    jsonb;
  v_order_id  uuid;
  v_sku       text;
  v_qty       int;
  v_price     int;
  v_placed    timestamptz;
  v_event_id  text;
  v_ext_order text;
  i           int;

  -- rotate through seeded TikTok Shop SKUs
  v_skus text[] := array[
    'TTS-VC-BT-100','TTS-VC-ANC-200','TTS-VC-PTY-50','TTS-VC-MIC-10',
    'TTS-PB-PRO-750','TTS-PB-GO-300','TTS-PB-JAR-64','TTS-PB-TAMP-1',
    'TTS-LM-AIR-2','TTS-LM-LAMP-S','TTS-LM-HUM-1','TTS-LM-DIFF-A'
  ];
  v_prices int[] := array[7999,14999,19999,5999,24999,8999,3999,1299,12999,4999,5999,2999];
begin
  select id into loc_vannuys from locations where name = 'Van Nuys DC';
  if loc_vannuys is null then
    raise exception 'seed prerequisite missing: Van Nuys DC location';
  end if;

  -- ---- 30 orders spread across the last ~3 days --------------------------
  for i in 1..30 loop
    v_sku       := v_skus[((i - 1) % array_length(v_skus, 1)) + 1];
    v_price     := v_prices[((i - 1) % array_length(v_prices, 1)) + 1];
    v_qty       := 1 + (i % 3);                  -- 1..3
    -- Split for demo shape: 15 recent orders (all "today" for any daytime
    -- UTC), 15 older ones spread over past 2 days so the feed has history.
    v_placed := case
      when i <= 15
        then now() - ((i * 10) || ' minutes')::interval
        else now() - interval '2 hours 30 minutes' - (((i - 15) * 180) || ' minutes')::interval
    end;
    v_ext_order := 'TTS-SEED-' || lpad(i::text, 4, '0');
    v_event_id  := 'evt_seed_' || lpad(i::text, 4, '0');

    v_result := process_order_event(
      'tiktok_shop',
      v_event_id,
      'order.created',
      jsonb_build_object(
        'event_id',    v_event_id,
        'event_type',  'order.created',
        'occurred_at', v_placed,
        'order', jsonb_build_object(
          'external_order_id', v_ext_order,
          'buyer_handle',      '@buyer_' || (100 + i),
          'placed_at',         v_placed,
          'lines', jsonb_build_array(
            jsonb_build_object(
              'external_sku',      v_sku,
              'qty',               v_qty,
              'unit_price_cents',  v_price
            )
          )
        )
      ),
      true,
      loc_vannuys
    );

    -- Ship roughly every third allocated order so the ledger has -qty
    -- entries and today's GMV isn't all "sitting in committed".
    v_order_id := (v_result->>'order_id')::uuid;
    if v_result->>'outcome' = 'allocated' and (i % 3) = 0 and v_order_id is not null then
      perform ship_order(v_order_id, loc_vannuys);
    end if;
  end loop;

  -- ---- Deliberate cancel: pick one recent order and cancel it ------------
  -- We reuse the webhook path so the event trail exists too.
  v_result := process_order_event(
    'tiktok_shop',
    'evt_seed_cancel_1',
    'order.cancelled',
    jsonb_build_object(
      'event_id',    'evt_seed_cancel_1',
      'event_type',  'order.cancelled',
      'occurred_at', now(),
      'order', jsonb_build_object(
        'external_order_id', 'TTS-SEED-0002',
        'placed_at',         now(),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'external_sku','TTS-VC-ANC-200','qty',1,'unit_price_cents',14999
          )
        )
      )
    ),
    true,
    loc_vannuys
  );

  -- ---- DLQ #1: unknown external_sku (retryable once ops fixes listing) ---
  perform process_order_event(
    'tiktok_shop',
    'evt_seed_dlq_unknown_sku',
    'order.created',
    jsonb_build_object(
      'event_id',    'evt_seed_dlq_unknown_sku',
      'event_type',  'order.created',
      'occurred_at', now() - interval '10 minutes',
      'order', jsonb_build_object(
        'external_order_id', 'TTS-SEED-DLQ-1',
        'buyer_handle',      '@edge_case_buyer',
        'placed_at',         now() - interval '10 minutes',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'external_sku','TTS-NEW-PRODUCT-NOT-LISTED-YET',
            'qty',1,
            'unit_price_cents',3499
          )
        )
      )
    ),
    true,
    loc_vannuys
  );

  -- ---- DLQ #2: cancel-before-create for a non-existent order --------------
  perform process_order_event(
    'tiktok_shop',
    'evt_seed_dlq_cancel_before',
    'order.cancelled',
    jsonb_build_object(
      'event_id',    'evt_seed_dlq_cancel_before',
      'event_type',  'order.cancelled',
      'occurred_at', now() - interval '4 minutes',
      'order', jsonb_build_object(
        'external_order_id', 'TTS-DOES-NOT-EXIST-YET',
        'placed_at',         now() - interval '4 minutes',
        'lines', jsonb_build_array(
          jsonb_build_object(
            'external_sku','TTS-VC-BT-100','qty',1,'unit_price_cents',7999
          )
        )
      )
    ),
    true,
    loc_vannuys
  );

  -- ---- Reset channel_inventory_reports to match reality after seed -------
  -- Migration 002 wrote reports matching the initial POs (120 units each).
  -- After our 30 seeded orders, `available` has moved. Wipe stale reports
  -- and reinsert current-truth ones, so reconciliation starts CLEAN.
  delete from channel_inventory_reports where channel_id = 'tiktok_shop';

  -- Backdate the "matching" rows so DISTINCT ON in run_reconciliation
  -- picks the newer skewed row we insert next (all rows in a single
  -- transaction share `now()`, so we need an explicit earlier timestamp).
  insert into channel_inventory_reports (channel_id, product_id, reported_qty, reported_at)
  select 'tiktok_shop', a.product_id, a.available, now() - interval '5 minutes'
    from available_to_sell a
   where exists (
     select 1 from channel_listings cl
      where cl.product_id = a.product_id and cl.channel_id = 'tiktok_shop'
   );

  -- ---- One deliberate open finding for the demo (LM-AIR-2 drifted +5) ----
  -- The reconciliation panel opens with exactly one red row.
  perform skew_channel_report('tiktok_shop', 'TTS-LM-AIR-2', 5);
  perform run_reconciliation();
end $$;
