# Module 3 — Brand Portal

**Serves:** brand clients directly (self-serve) + account managers (fewer hand-built weekly emails) · **Builds on:** the multi-tenant RLS model already on `brands`/`products`/`orders`/`purchase_orders`, `gmv_today`-style views, Module 4's attribution + snapshots.

**One-liner from `ROADMAP.md`:** every brand gets a login. Retention feature first, sales-demo asset second.

---

## Success metrics

The module lands when:

1. **Every active brand has a portal user** — no more "please send me last week's numbers" emails to AMs.
2. **Automated weekly digest** delivered on Monday 9am PT (email + in-portal) covering GMV, orders, inventory position, top creators, upcoming streams.
3. **Zero brand-boundary leaks**: RLS proves out — a brand's session can never read another brand's rows even through the most creative query construction.
4. AM time-per-brand-per-week drops from N hours (baseline in intake) to <1 hour.

Adoption threshold: three brands actively using the portal within one month of launch (revealed retention).

---

## Hard prerequisites

- **Module 4 must be at least PR M4-G merged** (campaign performance dashboards) so the portal has attribution + creator context to show, not just GMV.
- **Ops auth already merged** as the cross-cutting infrastructure (see `README.md`) — session gating is the pattern the brand portal extends.

---

## What makes this module cheap

The schema barely changes. Almost everything the portal renders already exists:
- `orders` → GMV, order count, per-status funnel
- `stock_levels` → current inventory position
- `campaign_summary`, `weekly_brand_digest` (M4-H) → creator + campaign performance
- `bay_current_state`, `bay_next_up` (M2) → upcoming/live streams for their brand

Brand portal is 80% careful RLS + 20% new UI. The biggest work is **auth + RLS wiring + a per-brand view of every existing dashboard**.

---

## Schema additions

Additive. Small.

### `brand_users`
Maps Supabase Auth users to the brand they represent. `auth.users.id` → `brands.id`.

```sql
create table brand_users (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  brand_id      uuid not null references brands(id),
  role          text not null default 'viewer'
                check (role in ('viewer','manager','owner')),
  invited_by    text,
  invited_at    timestamptz not null default now(),
  first_login_at timestamptz,
  last_login_at  timestamptz
);

create index brand_users_by_brand on brand_users (brand_id);
```

### `brand_digests`
Written by the weekly cron. Each row is one week's snapshot; the email + portal digest page render from here.

```sql
create table brand_digests (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references brands(id),
  week_start     date not null,                        -- Monday-anchored
  week_end       date not null,
  payload        jsonb not null,                       -- the whole rendered content
  sent_email_at  timestamptz,
  computed_at    timestamptz not null default now(),
  unique (brand_id, week_start)
);
```

### RLS policies (the important part)

Enable RLS on every brand-scoped table and add policies keyed off `brand_users`. Migration also grants `authenticated` role SELECT on the tables (previously service_role only).

```sql
-- Example for orders. Repeat pattern for every brand-scoped table.
create policy brand_read_own_orders on orders
  for select
  using (brand_id in (
    select brand_id from brand_users where user_id = auth.uid()
  ));

-- Products, PO, stock_levels join through products.brand_id
create policy brand_read_own_products on products
  for select
  using (brand_id in (
    select brand_id from brand_users where user_id = auth.uid()
  ));

create policy brand_read_own_stock on stock_levels
  for select
  using (product_id in (
    select id from products
    where brand_id in (
      select brand_id from brand_users where user_id = auth.uid()
    )
  ));

-- Views inherit RLS from base tables in PG14+, so the views written in
-- Modules 1/2/4 that filter to brand_id "for free" will just work.
```

Tables that DON'T get brand-scoped RLS (shared across brands, ops-only): `suppliers`, `channels`, `channel_secrets`, `oauth_tokens`, `adapter_events`, `webhook_events`, `outbox`, `hosts`, `bays`, `reconciliation_*`.

---

## Domain functions

**`invite_brand_user(brand_id, email, role)`** — sends an invite via Supabase Auth's invite flow, inserts a `brand_users` row with the pending user id, returns invite URL for the AM to forward.

**`compute_brand_digest(brand_id, week_start)`** — one function that computes the whole weekly snapshot payload from the existing views: GMV total + trend, order count + backordered count, top 5 SKUs by GMV, top 5 creators by attributed GMV, upcoming stream count, inventory alerts (from Module 1's `replenishment_alerts` filtered by brand).

Called by:
- Weekly cron (Monday 9am PT UTC-adjusted).
- On-demand from the portal's "Rebuild this week" admin button.

---

## Routes + pages (brand-scoped)

All under `/portal/[brand_slug]` — the slug in the URL is verified against the session's `brand_users` row on every render. Wrong slug → 403.

### `/portal/[brand_slug]`
Overview. Cards: GMV this week vs last, orders trend, backordered count, inventory low-stock count, upcoming streams count. Full view of the current week's `brand_digests` payload if available.

### `/portal/[brand_slug]/orders`
Filterable, paginated list of the brand's orders. Reuses `recent_orders` view (RLS scopes to brand).

### `/portal/[brand_slug]/inventory`
Reuses `stock_dashboard` (RLS scopes to brand). Low-stock badges from Module 1.

### `/portal/[brand_slug]/creators`
Creators who have posted for this brand. Reuses `creator_economics` (RLS via `attributions.brand_id`).

### `/portal/[brand_slug]/streams`
Upcoming + recent streams tagged to this brand. Reuses `bay_next_up` + stream_summary.

### `/portal/[brand_slug]/digests`
Past weekly digests archive.

### `/portal/[brand_slug]/settings`
Brand's own users, invite management (`brand_users`), notification preferences.

### Ops-side routes
- `/admin/brands` — AM view of all brands, users per brand, digest send status.
- `POST /api/portal/invites` — invite user (AM-only).
- `POST /api/portal/digests/[brand_id]/rebuild` — force rebuild.

---

## Auth flow

- Uses Supabase Auth (already provisioned, we just haven't wired the client). Magic-link email flow.
- Middleware in `middleware.ts` at the app root: if URL matches `/portal/*`, verify session; if `[brand_slug]` in URL doesn't match session's `brand_users.brand_id`, return 403.
- Ops routes (`/admin/*`) require a separate `staff` role — a new `staff_users` table mirrors `brand_users`.

---

## PR breakdown

Total: ~2,500-3,000 LOC across 4 PRs.

### PR M3-A: RLS retrofit + auth wiring (~800 LOC)
- Migration 016: `brand_users`, `staff_users`, all the RLS policies described above.
- Middleware for `/portal/*` and `/admin/*`.
- Supabase Auth client + session helpers in `lib/auth/`.
- `/portal/login` (magic-link entry).
- ADR-013: RLS-first tenancy for the portal.
- Test: brand A's session queries orders → sees only A's rows. Same for products, stock, everything brand-scoped.

### PR M3-B: portal overview + core pages (~900 LOC)
- `/portal/[brand_slug]` overview.
- `/portal/[brand_slug]/orders`, `/inventory`, `/streams`.
- Reuses server components from existing dashboards, wrapped in brand-slug validation.
- No new views — just RLS-filtered reads of existing ones.

### PR M3-C: creator visibility + settings (~500 LOC)
- `/portal/[brand_slug]/creators` — the "your creators" table with ROI per creator.
- `/portal/[brand_slug]/settings` — user management, invite flow, notification prefs.
- `POST /api/portal/invites`.

### PR M3-D: weekly digest + email (~700 LOC)
- Migration 017: `brand_digests`.
- `compute_brand_digest` RPC.
- `/portal/[brand_slug]/digests` archive.
- Cron in `cron-worker/` (or new `digest-worker/`): every Monday, iterate brands with `brand_users`, compute digest, write row, send email via Resend (or the Cloudflare Email Workers path).
- ADR-014: which email vendor and why.
- Ops admin: `/admin/brands` + `POST /api/portal/digests/[brand_id]/rebuild`.

---

## Testing

- **RLS: no cross-brand leaks.** Vitest suite: for every brand-scoped table, insert two brands' rows, authenticate as brand A, assert query returns 0 rows for brand B's data. Repeat for every RLS-touched table.
- **RLS: views inherit** — the same test through `stock_dashboard`, `recent_orders`, `sku_margin_by_channel`, etc.
- **Brand slug mismatch → 403.** Session for brand A tries `/portal/brand-b-slug/orders` → 403.
- **Digest computation determinism** — same `compute_brand_digest(brand, week)` call twice returns byte-identical payload (barring `computed_at`).
- **Invite flow round-trip** — invite email → magic link → new `brand_users` row → user lands on brand overview.

---

## Deliberate deferrals

- **In-portal messaging with AMs.** Slack or email suffices; adding a comms surface is a whole separate product.
- **Payouts / invoicing view.** Belongs to Module 5's finance direction, not the brand's daily view.
- **File uploads** (brand submitting media, contracts). Third-party via Google Drive or similar; not core module.
- **Multi-brand user support** (one user representing multiple brands via `brand_users` with multiple rows). Schema supports it, UI defers until asked for.
- **White-labeled portal domains** (their-brand-name.commerce-os.io). Nice-to-have Q4+.

---

## Open questions

1. **Magic link vs password.** Recommendation: magic link only, no passwords. Removes a whole class of support tickets.
2. **Digest cadence configurable per brand?** Weekly default; monthly available. Two rows in `brand_users` prefs — small addition.
3. **Ops impersonation** — AMs sometimes need to see exactly what the brand sees. Recommendation: session-switch via a dedicated `/admin/brands/[id]/impersonate` route that writes an audit-trail row.
4. **Digest email deliverability** — SPF/DKIM/DMARC setup on our sending domain. Ops call, not engineering.

---

## Landed

_This section fills in with merged PR numbers as they land._
