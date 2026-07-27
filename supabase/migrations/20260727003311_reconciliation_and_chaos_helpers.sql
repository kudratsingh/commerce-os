-- ============================================================================
-- COMMERCE OS — Reconciliation panel + chaos helpers (Migration 005)
--
-- Day 4 adds the in-app chaos simulator, the reconciliation panel, and the
-- NL query bar. This migration adds:
--   1. resolve_reconciliation_finding — the "Resolve" button on each finding
--   2. skew_channel_report — the "Skew" chaos button's server-side helper
--      (writes a channel_inventory_reports row deliberately off from truth
--      so the next run_reconciliation() surfaces a finding)
--   3. Views for the reconciliation panel (open findings + recent runs)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. resolve_reconciliation_finding
--
--    Ops has looked at the finding (either the channel side was wrong, or
--    they pushed a corrective inventory update). Marking resolved keeps the
--    row for audit but drops it out of the open findings view.
-- ----------------------------------------------------------------------------

create or replace function resolve_reconciliation_finding(
  p_finding_id bigint
) returns jsonb
language plpgsql as $$
declare
  v_prev  text;
begin
  select status into v_prev
    from reconciliation_findings
   where id = p_finding_id
   for update;

  if v_prev is null then
    raise exception 'finding % not found', p_finding_id;
  end if;

  if v_prev = 'resolved' then
    return jsonb_build_object('outcome', 'already_resolved', 'finding_id', p_finding_id);
  end if;

  update reconciliation_findings
     set status = 'resolved'
   where id = p_finding_id;

  return jsonb_build_object('outcome', 'resolved', 'finding_id', p_finding_id);
end $$;

-- ----------------------------------------------------------------------------
-- 2. skew_channel_report
--
--    Chaos "Skew" button. Writes a channel_inventory_reports row that
--    disagrees with our available-to-sell by `p_delta` units. The very next
--    run_reconciliation() surfaces it as a channel_drift finding, which
--    then shows red in the panel until an operator hits Resolve. Real ops
--    scenario: TikTok's cache diverged from ours after a bulk import.
-- ----------------------------------------------------------------------------

create or replace function skew_channel_report(
  p_channel_id text,
  p_sku        text,
  p_delta      integer
) returns jsonb
language plpgsql as $$
declare
  v_product_id uuid;
  v_available  integer;
  v_reported   integer;
begin
  -- Resolve the product via channel_listings (same path the webhook uses)
  select p.id into v_product_id
    from channel_listings cl
    join products p on p.id = cl.product_id
   where cl.channel_id   = p_channel_id
     and cl.external_sku = p_sku
     and cl.active;

  if v_product_id is null then
    raise exception 'unknown external_sku "%" on channel %', p_sku, p_channel_id;
  end if;

  select coalesce(a.available, 0)
    into v_available
    from available_to_sell a
   where a.product_id = v_product_id;

  v_reported := greatest(0, coalesce(v_available, 0) + p_delta);

  insert into channel_inventory_reports (channel_id, product_id, reported_qty)
    values (p_channel_id, v_product_id, v_reported);

  return jsonb_build_object(
    'outcome',      'skewed',
    'channel_id',   p_channel_id,
    'product_id',   v_product_id,
    'available',    v_available,
    'reported',     v_reported,
    'delta',        p_delta
  );
end $$;

-- ----------------------------------------------------------------------------
-- 3. Views for the reconciliation panel
-- ----------------------------------------------------------------------------

create or replace view open_findings as
select
  f.id,
  f.run_id,
  f.kind,
  f.product_id,
  p.sku,
  p.title,
  b.name        as brand_name,
  f.location_id,
  l.name        as location_name,
  f.channel_id,
  f.expected,
  f.actual,
  f.delta,
  f.status,
  f.created_at
from reconciliation_findings f
join products  p on p.id = f.product_id
join brands    b on b.id = p.brand_id
left join locations l on l.id = f.location_id
where f.status = 'open'
order by f.created_at desc;

create or replace view recent_recon_runs as
select
  r.id,
  r.started_at,
  r.finished_at,
  r.findings_count,
  extract(epoch from (r.finished_at - r.started_at)) * 1000 as elapsed_ms
from reconciliation_runs r
order by r.started_at desc
limit 20;

-- ----------------------------------------------------------------------------
-- 4. Grants
-- ----------------------------------------------------------------------------

grant select on open_findings, recent_recon_runs to service_role;

grant execute on function
  resolve_reconciliation_finding(bigint),
  skew_channel_report(text, text, integer)
to service_role;
