# Module 4 — Creator & Affiliate Operations + Performance Intelligence

**Serves:** affiliate managers, sample center staff, live producers · **Builds on:** `orders` (for attribution), `stock_movements` (samples ARE stock movements with reason `sample_sent`), the multi-tenant brand model.

**One-liner from `ROADMAP.md`:** turn a 20,000-creator network run on spreadsheets into a CRM with a physical supply chain attached. Ship a metrics spine that also powers Module 2's live floor boards — one snapshot store, two consumers.

This is the largest module in the roadmap, and the highest leverage: the roadmap calls this and Module 2 "the two most Platinum-shaped things software can do here."

---

## Success metrics

The module lands when:

1. Affiliate managers stop working from spreadsheets — outreach, sample approvals, and commission tracking all live in `/creators`.
2. Every order from an attribution link ties to a creator/video/stream in `attributions` — no manual reconciliation to build ROI reports.
3. Sample center's inventory is accounted for as `stock_movements` (reason: `sample_sent`) — the current "shrinkage" number drops to ~zero.
4. The metrics spine emits live per-stream + per-creator numbers on the four `PCU / GMV / CTR / ROI` families Module 2 needs.
5. A weekly digest per brand + per creator writes itself.

Adoption threshold: sample center manager approves reduction of manual receipt log from 100+ hourly entries to zero.

---

## Two halves of one module

Module 4 is really two integrated halves. Both share the metrics spine at the bottom.

### 4A — Creator CRM (outreach → sample → deliverable → commission)

Every creator is a row. Their state moves through: **contacted → replied → accepted → sampled → posted → paid**. Deliverables are counted, commissions calculated, samples tracked as inventory.

### 4B — Performance Intelligence (creators + streams)

The full indicators table from ROADMAP.md — **Reach / Retention / Engagement / Funnel / Revenue / Merch timing / Paid / Quality / Ops** for streams; **Output / Audience / Conversion / Economics / Pipeline / Quality** for creators. Every raw fact lands in append-only `*_snapshots` tables; every derived metric is a SQL view.

The two halves are one module because the CRM without metrics is a Rolodex, and the metrics without the CRM are a dashboard without an owner. Ship them together.

---

## Schema additions

Additive. **Nine new tables** — this is the biggest schema drop in the roadmap. Grouped so the migration reads top-down.

### CRM half

```sql
-- Every person or account we might work with
create table creators (
  id                 uuid primary key default gen_random_uuid(),
  handle             text not null unique,               -- @username on their platform
  platform           text not null check (platform in
                       ('tiktok','instagram','youtube','twitch','other')),
  display_name       text,
  contact_email      text,
  contact_phone      text,
  base_country       char(2),
  primary_categories text[],                             -- ['beauty','tech',...]
  follower_count     integer,                            -- last-seen
  engagement_rate    numeric(6,4),                       -- last-seen decimal
  metadata           jsonb not null default '{}'::jsonb,
  status             text not null default 'contacted'
                     check (status in ('prospect','contacted','replied','accepted','active','declined','blocked')),
  first_contacted_at timestamptz,
  became_active_at   timestamptz,
  created_at         timestamptz not null default now()
);

-- Outreach + acceptance pipeline
create table creator_touchpoints (
  id            bigint generated always as identity primary key,
  creator_id    uuid not null references creators(id),
  kind          text not null check (kind in
                  ('outreach','reply','call','meeting','sample_request','sample_ship','contract','other')),
  direction     text not null check (direction in ('outbound','inbound')),
  medium        text,
  notes         text,
  actor         text,                                    -- ops staff handle
  occurred_at   timestamptz not null default now()
);

-- Campaigns roll up creator work under a purpose (product launch, seasonal push)
create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id),
  name           text not null,
  starts_at      timestamptz,
  ends_at        timestamptz,
  budget_cents   bigint check (budget_cents >= 0),
  goal_gmv_cents bigint,
  status         text not null default 'draft'
                 check (status in ('draft','active','paused','ended','archived')),
  created_at     timestamptz not null default now()
);

create table campaign_creators (
  campaign_id       uuid not null references campaigns(id),
  creator_id        uuid not null references creators(id),
  commission_bps    integer not null check (commission_bps >= 0),   -- basis points
  agreed_deliverables integer not null default 1 check (agreed_deliverables >= 0),
  status            text not null default 'pending'
                    check (status in ('pending','accepted','declined','completed')),
  accepted_at       timestamptz,
  primary key (campaign_id, creator_id)
);

-- Sample requests + shipments
create table sample_requests (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid not null references creators(id),
  campaign_id        uuid references campaigns(id),
  product_id         uuid not null references products(id),
  qty                integer not null check (qty > 0),
  status             text not null default 'requested'
                     check (status in ('requested','approved','shipped','delivered','declined','returned')),
  requested_by       text,
  requested_at       timestamptz not null default now(),
  approved_at        timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  tracking_number    text,
  notes              text,
  stock_movement_id  bigint references stock_movements(id)   -- populated on ship
);

-- What actually got posted / streamed
create table creator_videos (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references creators(id),
  platform_video_id text not null,
  campaign_id     uuid references campaigns(id),
  brand_id        uuid references brands(id),
  posted_at       timestamptz,
  url             text,
  caption         text,
  duration_ms     integer,
  detected_by     text not null default 'api' check (detected_by in ('api','manual','import')),
  created_at      timestamptz not null default now(),
  unique (creator_id, platform_video_id)
);
```

### Live streams half

```sql
create table hosts (
  id             uuid primary key default gen_random_uuid(),
  display_name   text not null,
  handle         text,
  hourly_rate_cents integer,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table bays (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,                 -- 'Bay 3'
  location_id    uuid references locations(id),
  active         boolean not null default true
);

create table streams (
  id             uuid primary key default gen_random_uuid(),
  bay_id         uuid not null references bays(id),
  brand_id       uuid references brands(id),
  primary_host_id uuid references hosts(id),
  scheduled_start timestamptz not null,
  scheduled_end  timestamptz not null,
  actual_start   timestamptz,
  actual_end     timestamptz,
  external_stream_id text,                              -- TikTok live id
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Per-stream product segments — what was pitched when
create table stream_segments (
  id             bigint generated always as identity primary key,
  stream_id      uuid not null references streams(id),
  product_id     uuid not null references products(id),
  segment_start  timestamptz not null,
  segment_end    timestamptz,
  script_notes   text
);
```

### Metrics spine (shared)

Every raw fact is append-only. Every derived number is a view. Same ledger philosophy as `stock_movements`.

```sql
-- Time-series snapshots for streams (viewer counts, GMV, conversion, etc.)
create table stream_snapshots (
  id              bigint generated always as identity primary key,
  stream_id       uuid not null references streams(id),
  captured_at     timestamptz not null default now(),
  viewers_current integer,
  viewers_unique_cumulative integer,
  peak_concurrent integer,
  average_concurrent integer,
  entry_source_split jsonb,                            -- {"for_you":0.6,"following":0.3,...}
  comments_count  integer,
  likes_count     integer,
  shares_count    integer,
  new_followers   integer,
  gmv_cents_cumulative bigint,
  orders_cumulative    integer,
  units_cumulative     integer,
  cart_impressions_cumulative integer,
  cart_clicks_cumulative      integer,
  ad_spend_cents_cumulative   bigint,
  source          text not null default 'api'
                  check (source in ('api','csv','manual'))
);

-- Time-series snapshots for creator videos
create table video_snapshots (
  id            bigint generated always as identity primary key,
  video_id      uuid not null references creator_videos(id),
  captured_at   timestamptz not null default now(),
  views         integer,
  likes         integer,
  comments      integer,
  shares        integer,
  saves         integer,
  reach         integer,
  followers_gained integer,
  gmv_cents_attributed bigint,
  orders_attributed    integer,
  source        text not null default 'api'
                check (source in ('api','csv','manual'))
);

-- The attribution join — an order to the creator/stream/video that drove it
create table attributions (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references orders(id),
  creator_id    uuid references creators(id),
  video_id      uuid references creator_videos(id),
  stream_id     uuid references streams(id),
  campaign_id   uuid references campaigns(id),
  source        text not null check (source in
                  ('affiliate_link','coupon_code','platform_reported','manual')),
  confidence    numeric(4,3) not null default 1.000 check (confidence >= 0 and confidence <= 1),
  captured_at   timestamptz not null default now(),
  unique (order_id, source)                            -- one primary attribution per source
);
```

RLS: `brand_id` on `campaigns`, `streams`, and via join on `creator_videos.brand_id`. `creators`, `hosts`, `bays` are shared — RLS opens to `service_role` for ops; brand portal (Module 3) sees only the creators that touch their brand.

---

## Domain functions

**`register_touchpoint(creator_id, kind, direction, medium, notes)`** — logs an outreach event and transitions `creators.status` if the transition rules match (first outreach: contacted; first reply: replied; contract signed: accepted; first payout: active). Atomic.

**`ship_sample(sample_request_id, tracking_number, shipped_by)`** — approves+ships in one call. Writes a `stock_movements` row with `reason='sample_sent'` (this is the "sample center leak" the roadmap flags), updates `sample_requests.status = 'shipped'`, stores the movement id.

**`attribute_order(order_id, source, creator_id?, video_id?, stream_id?, campaign_id?, confidence)`** — inserts or updates an `attributions` row. Called by:
- inbound webhook when marketplace reports attribution (source: `platform_reported`),
- affiliate-link resolver (source: `affiliate_link`) when order metadata carries a code,
- ops manual attribution UI (source: `manual`).

`ON CONFLICT (order_id, source) DO UPDATE` — the latest fact wins per source.

**`ingest_stream_snapshot(stream_id, snapshot jsonb)`** — writes a `stream_snapshots` row after light validation. Called by adapter cron pulls (per API) and by CSV upload UI.

**`compute_stream_kpis(stream_id)`** — reads the latest `stream_snapshots` row + `orders` attributed to the stream, returns the whole KPI object (GPM, GMV/hour, cart-CTR, cart-CVR, ROAS, etc.). Called by the control-room boards in Module 2.

**`compute_creator_kpis(creator_id, window interval)`** — same shape for creators. ROI = attributed GMV ÷ (sample cost + commission).

---

## Read layer — every metric group as a view

Naming pattern: `<subject>_<metric_group>`.

**Live-stream views** (per ROADMAP.md indicators table):

- `stream_reach`, `stream_retention`, `stream_engagement`, `stream_funnel`
- `stream_revenue` (GPM, GMV/hour, AOV)
- `stream_merch_timing` (per-SKU units sold by minute, mapped to segments)
- `stream_paid` (ad spend, ROAS)
- `stream_quality` (cancellation rate, refund rate attributed to the stream)
- `stream_ops` (scheduled vs actual airtime, $/hour by host, conversion by host and category)

**Creator/affiliate views:**

- `creator_output`, `creator_audience`, `creator_conversion`, `creator_economics`
- `creator_pipeline` (outreach→reply→acceptance funnel over time)
- `creator_quality` (return rate on creator-attributed orders, content compliance flags)

Rollup views for dashboards:

- `campaign_summary` — GMV, orders, commissions paid, ROI per campaign.
- `weekly_brand_digest` — the row that becomes the weekly email in Module 3.

---

## Routes + pages

### `/creators`
CRM home. Filters: status, category, campaign, last-active. Table: handle, followers, category, last touchpoint, GMV attributed (last 30d), status pill.

### `/creators/[id]`
Profile: touchpoint timeline, current campaigns, sample history, videos posted, attributed GMV chart. Actions: **New touchpoint**, **Request sample**, **Add to campaign**.

### `/campaigns`
Campaign list + create. Per-row: goal vs actual GMV bar, creators enrolled, spend vs budget.

### `/campaigns/[id]`
Roster view: creators, deliverables committed vs shipped, individual GMV/commission, ROI ranking.

### `/samples`
Sample-center console. Requested → Approved → Shipped queues. Per-row action: **Approve + ship** (calls `ship_sample`).

### `/live`
Live-floor overview (this is the Module 2 landing, but it READS these views). Shown here to make the seam explicit: Module 4 owns the metrics, Module 2 owns the presentation.

### API routes
- `POST /api/creators` — create, `PATCH /api/creators/[id]` — update
- `POST /api/creators/[id]/touchpoints` — log outreach event
- `POST /api/campaigns` — create
- `POST /api/campaigns/[id]/creators` — enroll
- `POST /api/samples` — request
- `POST /api/samples/[id]/ship` — approve + ship (calls `ship_sample`)
- `POST /api/attributions` — manual attribution override
- `POST /api/adapters/tiktok/analytics-sync` — pull latest stream + video snapshots (cron)
- `POST /api/uploads/analytics-csv` — CSV import for metrics the API doesn't expose

---

## PR breakdown

Sized so the CRM half ships PR-by-PR while the metrics half compounds. First PR opens the module; subsequent PRs stack. Total: ~4,500-5,500 LOC across 8 PRs.

### PR M4-A: schema — CRM half (~700 LOC)
- Migration 012: `creators`, `creator_touchpoints`, `campaigns`, `campaign_creators`, `sample_requests`, `creator_videos`.
- `lib/queries/creators.ts`, `lib/queries/campaigns.ts`.
- `register_touchpoint` + `ship_sample` RPCs.
- ADR-011: append-only touchpoints as the CRM ledger.
- Integration tests: touchpoint sequence + `ship_sample` writes correct stock_movements row.

### PR M4-B: creator CRM UI (~800 LOC)
- `/creators` list + filter + search.
- `/creators/[id]` profile.
- Touchpoint form + timeline component.
- `POST /api/creators`, `POST /api/creators/[id]/touchpoints`.
- Nav: Header gets **Creators** entry.

### PR M4-C: campaigns + samples UI (~600 LOC)
- `/campaigns`, `/campaigns/[id]`, `/samples`.
- `POST /api/campaigns`, `POST /api/samples`, `POST /api/samples/[id]/ship`.
- Sample-center queue view.

### PR M4-D: schema — metrics spine (~700 LOC)
- Migration 013: `hosts`, `bays`, `streams`, `stream_segments`, `stream_snapshots`, `video_snapshots`, `attributions`.
- Base views: `stream_reach`, `stream_engagement`, `creator_output`, `creator_pipeline`.
- `ingest_stream_snapshot` + `attribute_order` RPCs.
- Integration tests: snapshot ingest + attribution reconciliation.

### PR M4-E: metrics views + CSV import (~500 LOC)
- Migration 014: the remaining metric-group views (`stream_funnel`, `stream_revenue`, `stream_merch_timing`, `stream_paid`, `stream_quality`, `stream_ops`, `creator_audience`, `creator_conversion`, `creator_economics`, `creator_quality`).
- `/uploads/analytics` page: CSV → validated staging table → merge into snapshots.
- `POST /api/uploads/analytics-csv`.

### PR M4-F: attribution pipeline (~500 LOC)
- Inbound webhook translation: extract creator/stream from marketplace-reported attribution.
- Affiliate-link resolver: `POST /api/attribution/resolve` that a marketplace's postback hits.
- Manual attribution UI on order detail (`/orders/[id]`, extend the existing order card).

### PR M4-G: campaign performance dashboards (~500 LOC)
- `campaign_summary` + `weekly_brand_digest` views.
- `/campaigns/[id]` performance charts (attributed GMV over time, top 5 creators, ROI board).
- `/creators/[id]` performance section.
- Uses Recharts (first time introducing it).

### PR M4-H: adapter pulls + digests (~500 LOC)
- Cron: nightly `/api/adapters/tiktok/analytics-sync` pulling latest stream + video snapshots.
- Weekly digest cron: writes a snapshot of `weekly_brand_digest` to `brand_digests` (new table) that Module 3 emails.
- Runbook: adding a new metric source.

---

## Testing

- **Attribution one-to-many**: one order can have multiple attributions from different sources (platform_reported + affiliate_link); manual override supersedes; test each combination.
- **Sample = stock movement**: `ship_sample` writes correct qty_delta, correct reason; total sample cost per creator matches sum of movements.
- **Metrics spine is idempotent**: same snapshot payload delivered twice → one row (dedupe by `(stream_id, captured_at)` or `(video_id, captured_at)`).
- **View math is contract-locked**: GPM = GMV / views × 1000 to 2 decimal places; regression tests pin the formulas.
- **CSV import**: bad rows land in a `staging_errors` table; good rows merge into `stream_snapshots` / `video_snapshots`; audit trail preserved.

---

## Deliberate deferrals

- **Predictive scoring**: which creators are worth outreach? Deferred to a later ML pass on the metrics spine, not core module.
- **Automated outreach sequencing** (drip campaigns). Real feature for Q4+, needs its own email infra.
- **Video content compliance**: computer-vision brand-safety check on video creative. Vendor call, not core module.
- **Two-way DM / comment integration**: read-only inbound analytics only. Live comment moderation is Module 2 territory.

---

## Open questions

1. **Attribution priority**: when multiple sources disagree, which wins? Recommendation: `platform_reported > affiliate_link > coupon_code > manual`. Highest-confidence source wins by default; manual overrides always.
2. **Snapshot cadence**: every 15 min for live streams, every hour for videos? Depends on API rate limits. Start conservative.
3. **Weekly digest delivery**: email, in-app, both? Recommendation: in-app first (portal reader), email once the portal has adoption.
4. **CSV schema**: version it? Yes — a `analytics_csv_schemas` table with per-column mapping, so schema changes over time are auditable and back-compatible imports still work.

---

## Landed

_This section fills in with merged PR numbers as they land._
