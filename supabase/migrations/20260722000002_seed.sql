-- ============================================================================
-- COMMERCE OS — Seed Data (Migration 002)
-- Populates demo data THROUGH the domain functions (receive_po_line), so the
-- ledger, rollup, and receipts agree by construction. Fictional brands that
-- rhyme with the real client mix: audio, blenders, home goods.
-- ============================================================================

-- Channels
insert into channels (id, display_name) values
  ('tiktok_shop', 'TikTok Shop'),
  ('amazon',      'Amazon'),
  ('walmart',     'Walmart'),
  ('ebay',        'eBay'),
  ('target_plus', 'Target+');

do $$
declare
  -- locations
  loc_vannuys uuid;
  loc_3pl     uuid;
  -- brands
  b_volt uuid; b_peak uuid; b_lumo uuid;
  -- products (4 per brand)
  p uuid;
  po uuid;
  pol uuid;
  prod record;
begin
  insert into locations (name, kind) values ('Van Nuys DC', 'warehouse') returning id into loc_vannuys;
  insert into locations (name, kind) values ('Reno 3PL',    '3pl')       returning id into loc_3pl;

  insert into brands (name) values ('Voltcore Audio') returning id into b_volt;
  insert into brands (name) values ('PeakBlend')      returning id into b_peak;
  insert into brands (name) values ('Lumo Home')      returning id into b_lumo;

  -- ---- catalog ----
  insert into products (brand_id, sku, title, cost_cents, price_cents) values
    (b_volt, 'VC-BT-100',  'Voltcore Bluetooth Speaker 100', 3200,  7999),
    (b_volt, 'VC-ANC-200', 'Voltcore ANC Headphones 200',    6500, 14999),
    (b_volt, 'VC-PTY-50',  'Voltcore Party Box 50',          9800, 19999),
    (b_volt, 'VC-MIC-10',  'Voltcore Streaming Mic 10',      2100,  5999),
    (b_peak, 'PB-PRO-750', 'PeakBlend Pro 750 Blender',     11800, 24999),
    (b_peak, 'PB-GO-300',  'PeakBlend Go 300 Personal',      3900,  8999),
    (b_peak, 'PB-JAR-64',  'PeakBlend 64oz Jar',             1400,  3999),
    (b_peak, 'PB-TAMP-1',  'PeakBlend Tamper',                350,   1299),
    (b_lumo, 'LM-AIR-2',   'Lumo Air Purifier 2',            5400, 12999),
    (b_lumo, 'LM-LAMP-S',  'Lumo Sunrise Lamp',              1900,  4999),
    (b_lumo, 'LM-HUM-1',   'Lumo Cool Mist Humidifier',      2300,  5999),
    (b_lumo, 'LM-DIFF-A',  'Lumo Aroma Diffuser',            1100,  2999);

  -- TikTok Shop listings for every product (external_sku = 'TTS-' || sku)
  insert into channel_listings (product_id, channel_id, external_sku)
  select id, 'tiktok_shop', 'TTS-' || sku from products;

  -- Amazon listings for a subset (shows multi-channel without noise)
  insert into channel_listings (product_id, channel_id, external_sku)
  select id, 'amazon', 'AMZ-' || sku from products
  where sku in ('VC-ANC-200', 'PB-PRO-750', 'LM-AIR-2');

  -- ---- one received PO per brand: stock flows in through the ledger ----
  for prod in
    select pr.id, pr.brand_id, pr.cost_cents,
           case when pr.sku like 'PB-TAMP%' then 500 else 120 end as qty
    from products pr
  loop
    -- one PO per brand (created lazily on first product of that brand)
    select id into po from purchase_orders
     where brand_id = prod.brand_id and supplier = 'Initial Stocking PO';
    if po is null then
      insert into purchase_orders (brand_id, supplier, status)
      values (prod.brand_id, 'Initial Stocking PO', 'received')
      returning id into po;
    end if;

    insert into purchase_order_lines (purchase_order_id, product_id, qty_ordered, unit_cost_cents)
    values (po, prod.id, prod.qty, prod.cost_cents)
    returning id into pol;

    -- receive through the domain function: ledger + rollup stay consistent
    perform receive_po_line(pol, loc_vannuys, prod.qty, 'seed');
  end loop;

  -- ---- marketplace inventory reports that MATCH reality (clean start) ----
  -- Chaos mode in the simulator will skew these live to demo reconciliation.
  insert into channel_inventory_reports (channel_id, product_id, reported_qty)
  select cl.channel_id, cl.product_id, a.available
  from channel_listings cl
  join available_to_sell a on a.product_id = cl.product_id
  where cl.channel_id = 'tiktok_shop';
end $$;
