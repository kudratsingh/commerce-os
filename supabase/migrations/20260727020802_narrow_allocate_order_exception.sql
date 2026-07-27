-- ============================================================================
-- COMMERCE OS — Narrow allocate_order's exception handling (Migration 006)
--
-- The original `allocate_order` (migration 001) used `EXCEPTION WHEN OTHERS`
-- and mapped every failure to 'backordered'. That masks real bugs (deadlocks,
-- typos, constraint violations from unrelated columns) as inventory problems
-- — you'd see "backordered" on a dashboard while the actual cause is a code
-- bug. The interview brief flagged this as a specificity issue worth fixing.
--
-- Fix: raise our own insufficient-stock exception with a custom SQLSTATE
-- (`PC001` — application-defined, avoids collision with standard codes), and
-- catch only that + the CHECK constraint. Any other error propagates to
-- `process_order_event`'s outer handler (migration 003), which correctly
-- records it as a `failed` webhook_event with the real `last_error` set —
-- exactly what an operator needs to fix it.
-- ============================================================================

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
        -- Custom SQLSTATE so the exception handler below can catch THIS
        -- specifically without catching (and hiding) unrelated errors.
        raise exception 'insufficient stock for product %', line.product_id
          using errcode = 'PC001';
      end if;
    end loop;

    update orders set status = 'allocated' where id = p_order_id;
    return 'allocated';

  exception
    when sqlstate 'PC001' then
      -- Our own insufficient-stock RAISE. Block-level rollback undid any
      -- partial reservations. Mark backordered and return the outcome.
      update orders set status = 'backordered' where id = p_order_id;
      return 'backordered';

    when check_violation then
      -- The CHECK (committed <= on_hand) firewall. Should never fire given
      -- the WHERE clause above, but if it does — race we didn't anticipate,
      -- a manual UPDATE elsewhere — it's still an oversell situation.
      -- Belt-and-suspenders: backorder rather than mask.
      update orders set status = 'backordered' where id = p_order_id;
      return 'backordered';

    -- Any OTHER exception (deadlock, typo, unrelated constraint violation,
    -- null-reference) propagates. The caller (process_order_event) catches
    -- it with `EXCEPTION WHEN OTHERS` at the outer level and records the
    -- specific error in webhook_events.last_error — visible in the DLQ.
  end;
end $$;

comment on function allocate_order(uuid, uuid) is
  'Allocate an order''s reservations. Insufficient-stock and CHECK-firewall '
  'failures return ''backordered''. All other errors propagate for DLQ '
  'visibility. See migration 006.';
