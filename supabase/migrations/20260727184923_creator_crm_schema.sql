-- ============================================================================
-- COMMERCE OS — Creator CRM schema (Migration 015, Module 4 / PR M4-A)
--
-- Turns a 20,000-creator network run on spreadsheets into a CRM with a
-- physical supply chain attached. Six new tables + two domain RPCs.
--
-- The philosophy mirrors the ledger:
--   • `creators` — the identity row per person/account. Status is derived
--     from the touchpoint stream, not a free-form field the app writes.
--   • `creator_touchpoints` — APPEND-ONLY log of every interaction. Each row
--     is a fact ("outreach sent on Tue," "reply received Wed"), never
--     mutated. Same shape as stock_movements: history is a story you can
--     read, not a state you edit.
--   • `campaigns` + `campaign_creators` — batches of creators under a
--     purpose (product launch, seasonal push). Commission stored as basis
--     points (integer, invariant #5) — no float money.
--   • `sample_requests` — where the CRM meets the ledger. `ship_sample()`
--     is the pivot: it writes a `stock_movements` row with reason
--     `sample_sent`, links back via `sample_requests.stock_movement_id`.
--     "Sample center shrinkage" becomes zero because samples ARE stock.
--   • `creator_videos` — outputs; the `attributions` join in Module 4-D
--     will hang orders off these.
--
-- ADR-012 covers the append-only-touchpoint choice + the status-derivation
-- rule. See `docs/adr/ADR-012-append-only-touchpoints.md`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extend stock_movements.reason CHECK with 'sample_sent'
--
-- The M4-A plan-doc claimed sample_sent was already in the constraint from
-- day 1. It wasn't; that was a design intent, not a check. Add it now so
-- ship_sample() can write ledger rows. Same DROP+ADD pattern the other
-- kind-constraint migrations use (007, 013).
-- ----------------------------------------------------------------------------

alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in (
    'po_receipt','order_shipment','return_received','adjustment',
    'transfer_in','transfer_out','damage','sample_sent'
  ));

-- ----------------------------------------------------------------------------
-- 1. creators — one row per person/account we might work with
-- ----------------------------------------------------------------------------

create table creators (
  id                  uuid primary key default gen_random_uuid(),
  handle              text not null unique,
  platform            text not null
                      check (platform in ('tiktok','instagram','youtube','twitch','other')),
  display_name        text,
  contact_email       text,
  contact_phone       text,
  base_country        char(2),
  primary_categories  text[] not null default '{}'::text[],
  follower_count      integer check (follower_count is null or follower_count >= 0),
  engagement_rate     numeric(6,4)
                      check (engagement_rate is null
                        or (engagement_rate >= 0 and engagement_rate <= 1)),
  metadata            jsonb not null default '{}'::jsonb,
  -- Status is derived by `register_touchpoint()` from the touchpoint stream;
  -- see ADR-012. App code MUST NOT write this column directly.
  status              text not null default 'prospect'
                      check (status in
                        ('prospect','contacted','replied','accepted','active','declined','blocked')),
  first_contacted_at  timestamptz,
  became_active_at    timestamptz,
  created_at          timestamptz not null default now()
);

create index creators_status_idx    on creators (status) where status <> 'blocked';
create index creators_platform_idx  on creators (platform);
create index creators_categories_idx on creators using gin (primary_categories);

comment on table creators is
  'One row per creator we might work with. Status is derived from the '
  'touchpoint stream via register_touchpoint(); do not UPDATE it directly.';

-- ----------------------------------------------------------------------------
-- 2. creator_touchpoints — APPEND-ONLY interaction log
--
-- Same guarantee as stock_movements (invariant #1 spiritually): every row
-- is a fact, never mutated. A "correction" is a new touchpoint with a note.
-- We surface this to the reader with a BEFORE UPDATE OR DELETE trigger.
-- ----------------------------------------------------------------------------

create table creator_touchpoints (
  id           bigint generated always as identity primary key,
  creator_id   uuid not null references creators(id),
  kind         text not null
               check (kind in
                 ('outreach','reply','call','meeting','sample_request',
                  'sample_ship','contract','payment','other')),
  direction    text not null check (direction in ('outbound','inbound')),
  medium       text,
  notes        text,
  actor        text,                                -- ops staff handle
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index touchpoints_creator_idx
  on creator_touchpoints (creator_id, occurred_at desc);
create index touchpoints_kind_idx
  on creator_touchpoints (kind);

create or replace function forbid_touchpoint_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'creator_touchpoints is append-only (attempted %). '
                  'Add a correcting touchpoint with a note instead.', tg_op;
end $$;

create trigger touchpoints_immutable
  before update or delete on creator_touchpoints
  for each row execute function forbid_touchpoint_mutation();

comment on table creator_touchpoints is
  'Append-only log of every interaction. Never UPDATE/DELETE; log a '
  'correcting row instead (see ADR-012).';

-- ----------------------------------------------------------------------------
-- 3. campaigns + campaign_creators — batches under a purpose
-- ----------------------------------------------------------------------------

create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id),
  name           text not null,
  starts_at      timestamptz,
  ends_at        timestamptz,
  budget_cents   bigint check (budget_cents is null or budget_cents >= 0),
  goal_gmv_cents bigint check (goal_gmv_cents is null or goal_gmv_cents >= 0),
  status         text not null default 'draft'
                 check (status in ('draft','active','paused','ended','archived')),
  created_at     timestamptz not null default now()
);

create index campaigns_brand_idx  on campaigns (brand_id);
create index campaigns_status_idx on campaigns (status);

create table campaign_creators (
  campaign_id          uuid not null references campaigns(id),
  creator_id           uuid not null references creators(id),
  -- basis points: 500 = 5.00%. Money-adjacent numbers are integer (invariant #5).
  commission_bps       integer not null check (commission_bps >= 0 and commission_bps <= 10000),
  agreed_deliverables  integer not null default 1 check (agreed_deliverables >= 0),
  status               text not null default 'pending'
                       check (status in ('pending','accepted','declined','completed')),
  accepted_at          timestamptz,
  primary key (campaign_id, creator_id)
);

create index campaign_creators_creator_idx on campaign_creators (creator_id);

comment on column campaign_creators.commission_bps is
  'Commission in basis points (integer). 500 = 5.00%. Never store as float.';

-- ----------------------------------------------------------------------------
-- 4. sample_requests — where the CRM meets the ledger
-- ----------------------------------------------------------------------------

create table sample_requests (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid not null references creators(id),
  campaign_id        uuid references campaigns(id),
  product_id         uuid not null references products(id),
  qty                integer not null check (qty > 0),
  status             text not null default 'requested'
                     check (status in
                       ('requested','approved','shipped','delivered','declined','returned')),
  requested_by       text,
  requested_at       timestamptz not null default now(),
  approved_at        timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  tracking_number    text,
  notes              text,
  -- Populated by ship_sample(): the sample_sent ledger row that acknowledges
  -- inventory left the sample-center door. Nullable until shipped.
  stock_movement_id  bigint references stock_movements(id)
);

create index sample_requests_creator_idx  on sample_requests (creator_id);
create index sample_requests_status_idx   on sample_requests (status) where status <> 'delivered';
create index sample_requests_campaign_idx on sample_requests (campaign_id) where campaign_id is not null;

comment on table sample_requests is
  'Sample requests. ship_sample() links this row to the stock_movements '
  'entry it wrote — auditor trail from creator to physical inventory drop.';

-- ----------------------------------------------------------------------------
-- 5. creator_videos — outputs (attributions join hangs off these in M4-D)
-- ----------------------------------------------------------------------------

create table creator_videos (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references creators(id),
  platform_video_id text not null,
  campaign_id       uuid references campaigns(id),
  brand_id          uuid references brands(id),
  posted_at         timestamptz,
  url               text,
  caption           text,
  duration_ms       integer check (duration_ms is null or duration_ms > 0),
  detected_by       text not null default 'api'
                    check (detected_by in ('api','manual','import')),
  created_at        timestamptz not null default now(),
  unique (creator_id, platform_video_id)
);

create index creator_videos_creator_idx on creator_videos (creator_id, posted_at desc);
create index creator_videos_campaign_idx on creator_videos (campaign_id)
  where campaign_id is not null;
create index creator_videos_brand_idx on creator_videos (brand_id)
  where brand_id is not null;

-- ----------------------------------------------------------------------------
-- RLS enable (policies land with Module 3 brand-portal)
-- ----------------------------------------------------------------------------

alter table creators             enable row level security;
alter table creator_touchpoints  enable row level security;
alter table campaigns            enable row level security;
alter table campaign_creators    enable row level security;
alter table sample_requests      enable row level security;
alter table creator_videos       enable row level security;

grant select, insert, update on
  creators, campaigns, campaign_creators, sample_requests, creator_videos
to service_role;
grant select, insert on creator_touchpoints to service_role;

-- ----------------------------------------------------------------------------
-- 6. register_touchpoint() — append + derive status transition
--
-- Every touchpoint is a fact. Some touchpoints trigger a status transition
-- on the parent creator:
--   • First outbound outreach → status='contacted', set first_contacted_at
--   • First inbound reply     → status='replied' (if currently 'contacted')
--   • Contract touchpoint     → status='accepted'
--   • First payment touchpoint → status='active', set became_active_at
--
-- Terminal states ('declined','blocked') are set out-of-band by the UI +
-- guarded by the check constraint — no touchpoint kind unlocks them.
-- ----------------------------------------------------------------------------

create or replace function register_touchpoint(
  p_creator_id  uuid,
  p_kind        text,
  p_direction   text,
  p_medium      text default null,
  p_notes       text default null,
  p_actor       text default null,
  p_occurred_at timestamptz default now()
) returns jsonb
language plpgsql as $$
declare
  v_touchpoint_id bigint;
  v_current_status text;
  v_new_status text;
  v_first_contacted_at timestamptz;
  v_became_active_at timestamptz;
begin
  -- Append the fact
  insert into creator_touchpoints
    (creator_id, kind, direction, medium, notes, actor, occurred_at)
  values
    (p_creator_id, p_kind, p_direction, p_medium, p_notes, p_actor, p_occurred_at)
  returning id into v_touchpoint_id;

  select status, first_contacted_at, became_active_at
    into v_current_status, v_first_contacted_at, v_became_active_at
    from creators
   where id = p_creator_id
   for update;

  if v_current_status is null then
    raise exception 'creator % does not exist', p_creator_id;
  end if;

  -- Derive transitions. Order matters: 'active' is terminal-forward, then
  -- 'accepted', 'replied', 'contacted'.
  if p_kind = 'payment' and v_current_status <> 'active' then
    v_new_status := 'active';
    if v_became_active_at is null then
      update creators set became_active_at = p_occurred_at where id = p_creator_id;
    end if;
  elsif p_kind = 'contract'
        and v_current_status in ('prospect','contacted','replied') then
    v_new_status := 'accepted';
  elsif p_kind = 'reply' and p_direction = 'inbound'
        and v_current_status in ('prospect','contacted') then
    v_new_status := 'replied';
  elsif p_kind = 'outreach' and p_direction = 'outbound'
        and v_current_status = 'prospect' then
    v_new_status := 'contacted';
    if v_first_contacted_at is null then
      update creators set first_contacted_at = p_occurred_at where id = p_creator_id;
    end if;
  end if;

  if v_new_status is not null then
    update creators set status = v_new_status where id = p_creator_id;
  end if;

  return jsonb_build_object(
    'touchpoint_id', v_touchpoint_id,
    'creator_id',    p_creator_id,
    'previous_status', v_current_status,
    'new_status',    coalesce(v_new_status, v_current_status)
  );
end $$;

grant execute on function
  register_touchpoint(uuid, text, text, text, text, text, timestamptz)
to service_role;

-- ----------------------------------------------------------------------------
-- 7. ship_sample() — approve+ship in one atomic call
--
-- The pivot function of Module 4. Takes a sample_request that's 'requested'
-- or 'approved', writes a `stock_movements` row with reason='sample_sent'
-- (which is why the ledger's `reason` check constraint already includes it
-- — designed for this from day 1), updates stock_levels.on_hand, updates
-- sample_requests to 'shipped' with the movement id.
--
-- Also logs a 'sample_ship' touchpoint on the creator so the CRM timeline
-- shows the shipment as an interaction — one action, two truths recorded.
-- ----------------------------------------------------------------------------

create or replace function ship_sample(
  p_sample_request_id uuid,
  p_location_id       uuid,
  p_tracking_number   text default null,
  p_shipped_by        text default null
) returns jsonb
language plpgsql as $$
declare
  v_req record;
  v_movement_id bigint;
  v_available integer;
begin
  select * into v_req
    from sample_requests
   where id = p_sample_request_id
   for update;

  if v_req.id is null then
    raise exception 'sample_request % not found', p_sample_request_id;
  end if;

  if v_req.status not in ('requested','approved') then
    return jsonb_build_object(
      'outcome', 'already_shipped',
      'status',  v_req.status,
      'sample_request_id', p_sample_request_id
    );
  end if;

  -- Sanity: is there stock to ship? Uses the same available-to-sell math
  -- the marketplace path uses; we don't want a sample to oversell a promise.
  select coalesce(sl.on_hand - sl.committed, 0)
    into v_available
    from stock_levels sl
   where sl.product_id = v_req.product_id
     and sl.location_id = p_location_id;

  if v_available < v_req.qty then
    raise exception 'insufficient stock at location % for sample: available %, need %',
      p_location_id, v_available, v_req.qty;
  end if;

  -- Append the ledger movement — reason='sample_sent' added to the
  -- stock_movements CHECK constraint in section 0 of this migration.
  insert into stock_movements
    (product_id, location_id, qty_delta, reason, ref_type, ref_id, note)
  values
    (v_req.product_id, p_location_id, -v_req.qty,
     'sample_sent', 'sample_request', null,
     format('sample to creator %s (request %s%s)',
       v_req.creator_id, p_sample_request_id,
       case when p_tracking_number is not null then ', tracking '||p_tracking_number else '' end))
  returning id into v_movement_id;

  -- Update the rollup in the same tx.
  update stock_levels
     set on_hand = on_hand - v_req.qty
   where product_id = v_req.product_id and location_id = p_location_id;

  -- Close the sample request.
  update sample_requests
     set status            = 'shipped',
         approved_at       = coalesce(approved_at, now()),
         shipped_at        = now(),
         tracking_number   = coalesce(p_tracking_number, tracking_number),
         stock_movement_id = v_movement_id
   where id = p_sample_request_id;

  -- Log a touchpoint so the creator's CRM timeline shows the shipment.
  insert into creator_touchpoints
    (creator_id, kind, direction, medium, notes, actor)
  values
    (v_req.creator_id, 'sample_ship', 'outbound', 'physical',
     format('shipped %sx of product %s%s',
       v_req.qty, v_req.product_id,
       case when p_tracking_number is not null then ' (tracking '||p_tracking_number||')' else '' end),
     p_shipped_by);

  return jsonb_build_object(
    'outcome',           'shipped',
    'sample_request_id', p_sample_request_id,
    'stock_movement_id', v_movement_id,
    'qty',               v_req.qty
  );
end $$;

grant execute on function ship_sample(uuid, uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 8. Dashboard views — pre-joined shapes for the CRM pages
--
-- Matches the pattern used by purchase_orders_dashboard and stock_dashboard:
-- do the joins in SQL, expose flat rows so the TS layer + typed supabase-js
-- reads stay simple. (supabase-js's parser struggles with multi-table
-- selects that use !inner in the select string — the view avoids the issue.)
-- ----------------------------------------------------------------------------

create or replace view sample_requests_dashboard as
  select
    sr.id,
    sr.creator_id,
    c.handle           as creator_handle,
    sr.campaign_id,
    sr.product_id,
    p.sku              as product_sku,
    p.title            as product_title,
    sr.qty,
    sr.status,
    sr.requested_at,
    sr.shipped_at,
    sr.tracking_number,
    sr.stock_movement_id
  from sample_requests sr
  join creators c on c.id = sr.creator_id
  join products p on p.id = sr.product_id;

create or replace view campaigns_dashboard as
  select
    cp.id,
    cp.brand_id,
    b.name              as brand_name,
    cp.name,
    cp.starts_at,
    cp.ends_at,
    cp.budget_cents,
    cp.goal_gmv_cents,
    cp.status,
    cp.created_at,
    (select count(*) from campaign_creators cc where cc.campaign_id = cp.id) as creators_enrolled
  from campaigns cp
  join brands b on b.id = cp.brand_id;

create or replace view campaign_creators_dashboard as
  select
    cc.campaign_id,
    cc.creator_id,
    c.handle       as creator_handle,
    c.status       as creator_status,
    cc.commission_bps,
    cc.agreed_deliverables,
    cc.status,
    cc.accepted_at
  from campaign_creators cc
  join creators c on c.id = cc.creator_id;

grant select on
  sample_requests_dashboard,
  campaigns_dashboard,
  campaign_creators_dashboard
to service_role;
