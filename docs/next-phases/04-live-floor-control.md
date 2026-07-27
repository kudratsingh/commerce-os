# Module 2 — Live Floor Control Room

**Serves:** live producers, hosts, studio ops · **Builds on:** `orders`, `stock_levels` (available-to-sell feed), all of Module 4's streams tables + metrics spine.

**One-liner from `ROADMAP.md`:** nine bays streaming daily is Platinum's most distinctive asset and the least served by generic software. Wasted airtime is the most perishable inventory in the building.

**Hard prerequisite:** Module 4 must ship first (specifically PRs M4-D and M4-E). Module 2's boards read `stream_snapshots`, `stream_segments`, and the derived views (`stream_reach`, `stream_revenue`, etc.). Building Module 2 first would either duplicate the schema (violates the "nothing built twice" principle) or produce a data-lite demo.

---

## Success metrics

The module lands when:

1. Every live studio has a **/live/[bay]** control panel open during airtime, showing live GMV, viewer count, next segment, and available-to-sell.
2. **Zero "we sold out but the host is still pitching it" incidents** in a full sales day — the available-to-sell feed reaches the host's screen within one second of a stock_levels change.
3. On-air producers can create coupons + kill them from the panel — no ops interrupts.
4. **Host $/hour and conversion-by-category** dashboards actually get used weekly by studio management.

Adoption threshold: producers refuse to run a live block without the panel open (revealed preference).

---

## The Durable Objects call

The ROADMAP calls it out explicitly: "one Durable Object per bay is the natural real-time aggregation point." This is our first use of Cloudflare Durable Objects and is worth pausing on:

- Nine bays → nine long-lived stateful objects. Each aggregates events for its bay (viewer counts, order stream, segment transitions) and pushes to connected browser clients via WebSockets.
- **Single-threaded per object** — no race conditions on "current segment," "current coupon," "current cumulative GMV." Multi-writer state is the number-one source of bugs in real-time systems; DO's give us that for free.
- **Cheap: pay per invocation** — a bay off-air costs nothing.
- **Not the source of truth** — Postgres is. DO's are a cache with strong ordering for hot per-bay reads. If a DO dies (deploy, region migration), it rehydrates from `stream_snapshots` + `orders` on wake.

If DO's turn out to be the wrong hammer, fallback is Supabase Realtime multiplexed per-bay channels (identical shape from the browser's perspective, just no server-side aggregation). Named as ADR-012 during the module.

---

## Schema additions

Small, because Module 4 did the heavy lifting. Three new tables here:

### `coupons`
Live-created discount codes. Kill switch lives on the panel.

```sql
create table coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  brand_id          uuid not null references brands(id),
  channel_id        text references channels(id),                -- null = all channels
  discount_kind     text not null check (discount_kind in ('pct','flat')),
  discount_bps      integer,                                     -- when kind = 'pct', basis points
  discount_flat_cents integer,                                    -- when kind = 'flat'
  min_subtotal_cents  integer default 0 check (min_subtotal_cents >= 0),
  max_uses          integer,                                      -- null = unlimited
  uses_count        integer not null default 0 check (uses_count >= 0),
  applies_to_product_id uuid references products(id),             -- null = brand-wide
  live_stream_id    uuid references streams(id),                  -- null if not on-air
  created_by_host_id uuid references hosts(id),
  created_at        timestamptz not null default now(),
  effective_from    timestamptz not null default now(),
  effective_until   timestamptz,
  killed_at         timestamptz,
  killed_reason     text,
  unique (code, effective_from)
);

create index coupons_active_by_code on coupons (code) where killed_at is null and effective_until is null;
```

### `bay_schedules`
Who's on which bay, when, for which brand. Basis for the calendar view + "next up" indicator on each bay panel.

```sql
create table bay_schedules (
  id                uuid primary key default gen_random_uuid(),
  bay_id            uuid not null references bays(id),
  brand_id          uuid not null references brands(id),
  primary_host_id   uuid references hosts(id),
  scheduled_start   timestamptz not null,
  scheduled_end     timestamptz not null,
  status            text not null default 'planned'
                    check (status in ('planned','confirmed','live','completed','cancelled')),
  notes             text,
  created_at        timestamptz not null default now()
);

-- No overlapping schedules per bay
create index bay_schedules_conflict on bay_schedules
  (bay_id, scheduled_start, scheduled_end)
  where status in ('planned','confirmed','live');
```

### `pitch_events`
When did the host pitch a product? Fires from the panel's "Now pitching" button. Feeds `stream_merch_timing` view (Module 4).

```sql
create table pitch_events (
  id            bigint generated always as identity primary key,
  stream_id     uuid not null references streams(id),
  product_id    uuid not null references products(id),
  pitched_at    timestamptz not null default now(),
  pitched_by    text,                                    -- host handle or producer
  duration_ms   integer,
  notes         text
);
```

---

## Domain functions

**`create_coupon(brand_id, code, kind, value, ...)`** — inserts + validates + returns the created row. Called by the panel's "New coupon" button. Enforces uniqueness of active code by killing (soft) any conflicting active coupon.

**`kill_coupon(coupon_id, reason)`** — sets `killed_at` + `killed_reason`. Idempotent.

**`start_stream(bay_id, host_id, brand_id, external_stream_id)`** — transitions the `bay_schedules` row to `status='live'`, creates or finds the `streams` row, opens a `pitch_events` window. Called at "go live" moment by the panel.

**`end_stream(stream_id)`** — writes `streams.actual_end`, transitions schedule to `completed`, closes open pitch events. Emits a `stream.ended` outbox event for post-processing (final snapshot pull, digest write, etc.).

**`available_to_sell_for_stream(stream_id)`** (view or function) — the host-facing "what's currently sellable" list, filtered by the products this stream is pitching (from `stream_segments` + `campaign_creators` if applicable). Read every second by the panel.

---

## Read layer

Reuses Module 4's views (`stream_reach`, `stream_revenue`, `stream_engagement`, `stream_funnel`, `stream_merch_timing`, `stream_paid`, `stream_ops`) and adds:

- **`bay_current_state`** — one row per bay: current schedule, current stream id, current host, current cumulative GMV, current viewer count, product being pitched. This is the view the multi-bay overview page reads.
- **`bay_next_up`** — for each bay, the next `bay_schedules` row `starts within 4 hours`.
- **`active_coupons_for_stream`** — coupons where `stream_id = $1 and killed_at is null`.

---

## Routes + pages

### `/live` (overview)
Grid of 9 tiles, one per bay. Each shows: current schedule/host/brand, live viewer count, GMV cumulative, cumulative orders. Click a tile → `/live/[bay_id]`.

### `/live/[bay_id]` (control panel)
Left column: viewer count (large), GMV (large), current PCU/ACU. Middle: available-to-sell list, filtered to this stream's segment (limit 10). Right: coupon quick-create + kill; "Now pitching: X" button per product. Bottom: live comment feed (fed by TikTok adapter analytics-sync).

**Client-side wire**: opens a WebSocket to the bay's Durable Object. DO pushes viewer/GMV/order events; browser renders. Panel state stays local; writes go via REST to the routes below, then the DO also receives the change (via the DB's Realtime channel or a direct hint).

### `/live/schedule`
Weekly calendar of bay schedules. Drag-and-drop create + edit. Overlap warnings in-line.

### API routes
- `POST /api/live/bays/[bay_id]/start` — go live (`start_stream`).
- `POST /api/live/bays/[bay_id]/end` — end stream (`end_stream`).
- `POST /api/live/streams/[stream_id]/pitch` — log a `pitch_events` row.
- `POST /api/live/coupons` — create.
- `POST /api/live/coupons/[id]/kill` — kill.
- `POST /api/live/schedules` — create.
- `PATCH /api/live/schedules/[id]` — update.

### Durable Object routes (Cloudflare)
- Per-bay DO named `bay-<uuid>`. Handlers: `ws://.../live-updates`, HTTP `POST /hint`.

---

## PR breakdown

Total: ~3,500-4,500 LOC across 6 PRs. Assumes Module 4 PRs M4-D and M4-E are landed.

### PR M2-A: schema + read layer (~500 LOC)
- Migration 015: `coupons`, `bay_schedules`, `pitch_events`, `bay_current_state`, `bay_next_up`, `active_coupons_for_stream`.
- `lib/queries/live.ts`.
- `create_coupon`, `kill_coupon`, `start_stream`, `end_stream` RPCs.
- Integration tests: coupon lifecycle, schedule conflict prevention.

### PR M2-B: `/live` overview + schedule page (~700 LOC)
- Server-rendered overview grid reading `bay_current_state`.
- `/live/schedule` calendar (start simple — a table with drag-drop; heavy calendar libs deferred).
- `POST /api/live/schedules`, `PATCH /api/live/schedules/[id]`.
- Nav: Header gets **Live** entry.

### PR M2-C: Durable Objects per bay (~600 LOC)
- ADR-012: Durable Objects vs Supabase Realtime multiplexing (with the fallback rationale).
- `cron-worker/` (or a new `live-worker/`) DO class definition.
- `/live/[bay_id]` panel connects over WS.
- Panel is read-only at first — writes come in PR M2-D.
- Integration tests: DO hydration from Postgres on cold start.

### PR M2-D: control panel writes — coupons + pitch events (~700 LOC)
- Coupon quick-create + kill from the panel.
- "Now pitching" toggle → `POST /api/live/streams/[stream_id]/pitch`.
- Panel emits hints to DO on writes so pushes to the browser are instant, not next-poll.
- Integration tests: coupon appears in `active_coupons_for_stream` view within one round-trip.

### PR M2-E: live-stream ingestion (~500 LOC)
- Extend TikTok adapter's analytics sync (from M4-H) to write `stream_snapshots` on the current bay's stream every 15 seconds while live.
- Comment feed: subset of the analytics sync surfaces to the panel.

### PR M2-F: host + category dashboards (~500 LOC)
- `/live/analytics` — host $/hour, conversion by host + category, over-time trend.
- Reads Module 4's `stream_ops` view.
- Recharts everything (installed in Module 4).

---

## Testing

- **Bay overlap**: creating a schedule that overlaps an existing `planned`/`confirmed`/`live` schedule on the same bay fails with a clear error.
- **DO cold start**: kill a DO, hit its WS endpoint, verify it rehydrates from `stream_snapshots` in <500ms.
- **Coupon uniqueness**: two coupons with the same active code cannot exist; the second creation kills the first with a clear reason.
- **Kill switch**: a killed coupon does NOT apply to new orders; the switch propagates to the checkout flow in <1s.
- **Available-to-sell freshness**: a stock_levels update in Postgres → panel shows new available number in ≤ 1s via DO or Realtime (whichever wins ADR-012).

---

## Deliberate deferrals

- **Automated cue-card generation** (AI-powered scripting for hosts). Module 7 pattern applied here later.
- **Face-recognition-based host analytics** (energy score, on-camera consistency). Vendor + privacy call.
- **Off-platform livestreaming** (Instagram Live, YouTube Live, Amazon Live). TikTok only for now.
- **Auction / flash-drop mechanics.** Fun feature, wrong module.
- **Producer chat / walkie-talkie interface.** Slack does this.

---

## Open questions

1. **DO or Realtime multiplex?** ADR-012 decides at the start of M2-C. Leaning DO for the aggregation semantics.
2. **Coupon codes globally unique, or per-brand?** Recommendation: **per-brand** but with a warning if a code collides across brands (customer confusion risk).
3. **How long does a DO stay alive after a stream ends?** Recommendation: 15 min for cleanup pulls, then hibernate.
4. **On-air alerts to hosts** (low-stock, coupon killed, high refund rate on last 5 orders) — voice / haptic / on-screen? Product call, not engineering. Punt.

---

## Landed

_This section fills in with merged PR numbers as they land._
