-- ============================================================================
-- COMMERCE OS — PO lifecycle RPCs (Migration 009)
--
-- Module 1 M1-B. Adds two RPCs the /purchasing UI calls:
--
--   • `receive_shipment` — supersedes `receive_po_line` from migration 001
--     with the same atomic ledger+rollup guarantee, plus a `landed_costs`
--     row so true landed unit cost is captured at receipt time (not
--     reconstructed later).
--
--   • `close_purchase_order` — administrative close on a PO whose lines
--     are fully received (or explicit force-close for abandoned POs).
--
-- `receive_po_line` is kept unchanged so the seed migration (002) still
-- applies cleanly on `supabase db reset`. New code paths should call
-- `receive_shipment` for the landed-cost capture.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- receive_shipment — expanded receipt with landed-cost snapshot
--
-- All-or-nothing per line: any failure inside rolls back the ledger row,
-- the stock_levels update, and the landed_costs row together.
--
-- PO status transition logic:
--   • sum(qty_received across all lines) < sum(qty_ordered)  → partially_received
--   • sum(qty_received) >= sum(qty_ordered)                  → received
-- ----------------------------------------------------------------------------

create or replace function receive_shipment(
  p_po_line_id     uuid,
  p_location_id    uuid,
  p_qty            integer,
  p_unit_cost_cents  integer,
  p_duties_cents     integer default 0,
  p_freight_cents    integer default 0,
  p_handling_cents   integer default 0,
  p_received_by    text default 'system'
) returns uuid
language plpgsql as $$
declare
  v_product_id  uuid;
  v_po_id       uuid;
  v_receipt_id  uuid;
  v_qty_ordered integer;
  v_qty_received integer;
begin
  if p_qty <= 0 then
    raise exception 'receive_shipment: qty must be positive';
  end if;
  if p_unit_cost_cents < 0 or p_duties_cents < 0
       or p_freight_cents < 0 or p_handling_cents < 0 then
    raise exception 'receive_shipment: cost components must be non-negative';
  end if;

  select product_id, purchase_order_id, qty_ordered
    into v_product_id, v_po_id, v_qty_ordered
    from purchase_order_lines
    where id = p_po_line_id;
  if v_product_id is null then
    raise exception 'receive_shipment: unknown purchase_order_line %', p_po_line_id;
  end if;

  -- 1. Receipt row
  insert into receipts (purchase_order_line_id, location_id, qty_received, received_by)
    values (p_po_line_id, p_location_id, p_qty, p_received_by)
    returning id into v_receipt_id;

  -- 2. Ledger row (append-only; ADR-001)
  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, created_by)
    values (v_product_id, p_location_id, p_qty, 'po_receipt',
            'receipt', v_receipt_id, p_received_by);

  -- 3. Rollup update — insert new row or bump on_hand
  insert into stock_levels (product_id, location_id, on_hand, committed)
    values (v_product_id, p_location_id, p_qty, 0)
    on conflict (product_id, location_id)
    do update set on_hand = stock_levels.on_hand + excluded.on_hand;

  -- 4. Landed cost snapshot — the M1-A addition (denormalized so margin
  --    computation never has to re-derive at report time)
  insert into landed_costs
    (receipt_id, product_id, qty, unit_cost_cents,
     duties_cents, freight_cents, handling_cents)
    values (v_receipt_id, v_product_id, p_qty, p_unit_cost_cents,
            p_duties_cents, p_freight_cents, p_handling_cents);

  -- 5. PO status transition (only if PO is not already 'closed')
  select coalesce(sum(r.qty_received), 0)
    into v_qty_received
    from receipts r
    where r.purchase_order_line_id in (
      select id from purchase_order_lines where purchase_order_id = v_po_id
    );

  select coalesce(sum(qty_ordered), 0)
    into v_qty_ordered
    from purchase_order_lines
    where purchase_order_id = v_po_id;

  update purchase_orders
     set status = case
       when status = 'closed' then 'closed'
       when v_qty_received >= v_qty_ordered then 'received'
       else 'partially_received'
     end
   where id = v_po_id;

  return v_receipt_id;
end $$;

comment on function receive_shipment(uuid, uuid, integer, integer, integer, integer, integer, text) is
  'Atomic PO receipt: receipt row + ledger row + rollup update + landed_costs snapshot. '
  'Transitions parent PO status. Supersedes receive_po_line (migration 001) — that fn '
  'is kept unchanged so the seed migration keeps working.';

-- ----------------------------------------------------------------------------
-- close_purchase_order — administrative close
--
-- Idempotent: closing an already-closed PO returns 'already_closed' JSON.
-- Refuses to close a PO with `draft` status (draft POs should be deleted
-- or edited, not closed).
-- ----------------------------------------------------------------------------

create or replace function close_purchase_order(
  p_po_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql as $$
declare
  v_current_status text;
begin
  select status into v_current_status
    from purchase_orders where id = p_po_id
    for update;

  if v_current_status is null then
    raise exception 'close_purchase_order: unknown PO %', p_po_id;
  end if;

  if v_current_status = 'closed' then
    return jsonb_build_object('outcome', 'already_closed', 'po_id', p_po_id);
  end if;

  if v_current_status = 'draft' then
    raise exception 'close_purchase_order: cannot close a draft PO — delete or convert first';
  end if;

  update purchase_orders
     set status = 'closed'
   where id = p_po_id;

  return jsonb_build_object(
    'outcome', 'closed',
    'po_id',   p_po_id,
    'previous_status', v_current_status,
    'reason',  p_reason
  );
end $$;

-- ----------------------------------------------------------------------------
-- create_purchase_order — create a PO with lines in a single call
--
-- The /purchasing/new form's server action calls this. Guarantees the PO
-- and all its lines commit together — a form that half-writes leaves an
-- orphan PO nobody can find.
-- ----------------------------------------------------------------------------

create or replace function create_purchase_order(
  p_brand_id     uuid,
  p_supplier_id  uuid,
  p_expected_at  date default null,
  p_lines        jsonb default '[]'::jsonb,   -- array of {product_id, qty_ordered, unit_cost_cents}
  p_created_by   text default 'system'
) returns uuid
language plpgsql as $$
declare
  v_po_id  uuid;
  v_line   jsonb;
  v_supplier_name text;
begin
  if p_brand_id is null then
    raise exception 'create_purchase_order: brand_id required';
  end if;

  -- Keep the free-text supplier column populated for compat with M1-A's
  -- backfill discipline (nullable but not dropped).
  select name into v_supplier_name from suppliers where id = p_supplier_id;

  insert into purchase_orders (brand_id, supplier, supplier_id, status, expected_at)
    values (p_brand_id, v_supplier_name, p_supplier_id, 'placed', p_expected_at)
    returning id into v_po_id;

  for v_line in select jsonb_array_elements(p_lines) loop
    insert into purchase_order_lines
      (purchase_order_id, product_id, qty_ordered, unit_cost_cents)
      values (
        v_po_id,
        (v_line->>'product_id')::uuid,
        (v_line->>'qty_ordered')::int,
        (v_line->>'unit_cost_cents')::int
      );
  end loop;

  return v_po_id;
end $$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------

grant execute on function
  receive_shipment(uuid, uuid, integer, integer, integer, integer, integer, text),
  close_purchase_order(uuid, text),
  create_purchase_order(uuid, uuid, date, jsonb, text)
to service_role;
