# Module 6.b+ — Marketplace Expansion (Amazon, Walmart, eBay, Target+)

**Serves:** everyone — every new marketplace is net-new distribution · **Builds on:** the adapter pattern established by [Module 6.a — TikTok Shop](./02-tiktok-shop-adapter.md), Module 1's fee schedules (each marketplace has its own).

**One-liner from `ROADMAP.md`:** each marketplace is an adapter PR against interfaces that already exist. The simulator becomes the regression harness for all of them.

---

## Success metrics

Per adapter (Amazon → Walmart → eBay → Target+):

1. Real production orders flow through `/api/adapters/[channel]/webhook` end-to-end within one production week of merging.
2. Outbound `available_to_sell` push works — no oversells attributed to our stock sync.
3. OAuth (or per-channel auth model) refreshes silently.
4. Adapter-specific quirks (Amazon SP-API rate limits, Walmart's XML feeds, eBay's REST + legacy shell) documented in an ADR per adapter.

Aggregate: **≥95% of the code delta per adapter is in the translation layer**, not in the domain functions. This is the "nothing built twice" test — if a new marketplace requires new domain functions, we designed the contract wrong.

---

## Sequencing (revenue-informed)

Per `ROADMAP.md`: TikTok Shop, then **Amazon SP-API, Walmart, eBay, Target+**. Sequence dictated by revenue potential per adapter for Platinum's brand mix:

1. **Amazon SP-API** — largest revenue upside, most complex integration (multi-marketplace-per-region, MWS legacy sunset, restricted product families). Longest per-adapter build.
2. **Walmart Marketplace** — second largest, straightforward JSON APIs, simpler auth.
3. **eBay** — mixed REST + legacy XML for some endpoints; smaller revenue but well-documented.
4. **Target+** — invitation-only, curated catalog, smallest volume but strategic account.

Each adapter is scoped as its own sub-module below.

---

## What each adapter reuses (the pattern)

Every adapter, without exception, follows the shape from [`02-tiktok-shop-adapter.md`](./02-tiktok-shop-adapter.md):

- `channel_secrets` row per credential
- `oauth_tokens` row per merchant (for OAuth 2.0 channels)
- `adapter_events` row per inbound webhook, deduped on their event id
- `/api/adapters/[channel]/webhook` → translate → sign with our secret → forward to `/api/webhooks/tiktok`
- Outbox consumer for outbound stock sync
- OAuth refresh cron (per adapter)
- CSV fallback for anything the API doesn't cover

New code per adapter breaks down as:

| Layer | Adapter-specific? | New code per adapter |
|---|---|---|
| `channels` row + `channel_listings` migration | Yes | ~10 LOC (one row + a comment) |
| `translate_[channel]_event()` SQL function | Yes | ~50-200 LOC (varies by their JSON shape) |
| Webhook auth (per their scheme) | Yes | ~80-200 LOC (each has quirks) |
| OAuth or API-key exchange | Sometimes | 0 (API key) to ~400 LOC (multi-step OAuth) |
| Outbound stock sync route + client | Yes | ~150-300 LOC |
| Fee schedule per channel | Yes | ~30 LOC (or a CSV import if their fees are complex) |
| `lib/adapters/[channel]/` config + docs | Yes | ~200-400 LOC |
| Domain functions | **No** | 0 |
| `process_order_event` / other RPCs | **No** | 0 |
| Views on `orders`/`stock_levels` | **No** | 0 |

---

## Amazon SP-API adapter

### Schema notes

Amazon has one uniquely painful concept: **marketplaces within their marketplace**. One seller account operates on `www.amazon.com`, `www.amazon.co.uk`, `amazon.de`, etc., each with different currency, fees, tax rules. Model this in an additive migration:

```sql
create table amazon_marketplaces (
  id                 text primary key,                 -- 'ATVPDKIKX0DER' etc.
  region             text not null,                    -- 'us','eu','fe'
  country_code       char(2) not null,
  currency           char(3) not null,
  active             boolean not null default true
);
```

`channel_id = 'amazon'` in our root table stays; the specific marketplace lives on `channel_listings` (add `marketplace_id text references amazon_marketplaces(id)` — nullable for other channels).

### Auth

Amazon SP-API uses LWA (Login with Amazon) OAuth + role-based access. Our `oauth_tokens` table extends with `role_arn text` (nullable, non-null for Amazon).

### PR breakdown (~2,800-3,500 LOC across 5 PRs)

- **M6b-A**: schema (`amazon_marketplaces`, channel_listings extension) + OAuth wiring + partner credentials setup.
- **M6b-B**: inbound webhook adapter (notifications for orders, price/inventory changes, feed processing status).
- **M6b-C**: outbound stock sync via feeds (Amazon batches updates through feed APIs — different shape than TikTok's per-item calls).
- **M6b-D**: outbound listing creation via Product Catalog API (this is where Amazon adapters usually earn their keep — catalog is 90% of the work).
- **M6b-E**: reports + settlement pull (feeds our Module 5 payout ingest).

Longest adapter build. Budget 6-10 weeks of a focused engineer.

---

## Walmart Marketplace adapter

### Schema notes

Much simpler than Amazon — one marketplace, USD only initially, JSON APIs. Additive migration adds `channels` row + one `walmart_seller_id` column on `oauth_tokens` (Walmart uses API-key + signed request pattern, not OAuth; we co-opt the token table with a stub refresh).

### Auth

Walmart uses signed requests with a `WM_CONSUMER.ID` + `WM_SEC.KEY_VERSION` + private key. Store the private key encrypted in `channel_secrets`. No refresh cycle — keys rotate manually.

### PR breakdown (~1,800-2,300 LOC across 4 PRs)

- **M6c-A**: schema (channels + auth) + signed-request client.
- **M6c-B**: inbound webhook adapter (Walmart calls webhooks "notifications").
- **M6c-C**: outbound stock sync + price sync.
- **M6c-D**: listing management (single-item + feed).

---

## eBay adapter

### Schema notes

No new tables. eBay operates on a single account with per-region site IDs (encoded as a header, not part of the URL).

### Auth

OAuth 2.0 (modern eBay APIs) — reuses `oauth_tokens` unchanged.

### PR breakdown (~1,500-2,000 LOC across 3 PRs)

- **M6d-A**: OAuth + inbound webhook adapter for order events.
- **M6d-B**: outbound stock sync + price sync.
- **M6d-C**: listing management. eBay's model is highly variable per category — we support the "basic listing" path first, defer variations (color/size/etc.) to a follow-up.

---

## Target+ (Target Plus) adapter

### Schema notes

Target+ is Target's curated marketplace — invitation-only, single account model, single US marketplace. Simplest of the four.

### Auth

Target uses simple API key + shared-secret HMAC. Reuses `channel_secrets` unchanged.

### PR breakdown (~1,000-1,500 LOC across 2-3 PRs)

- **M6e-A**: schema + auth + inbound webhook adapter.
- **M6e-B**: outbound sync + listing.

Smallest adapter build. Budget 2-3 weeks.

---

## The simulator becomes the regression harness

The `pnpm sim:fire` CLI + `/simulator` chaos panel from PR #3 speak OUR internal contract. Every new marketplace adapter can be tested by:

1. Recording a real webhook payload from the marketplace (sandbox account).
2. Adding it as a fixture under `lib/adapters/[channel]/fixtures/`.
3. Firing it through the adapter's real `/api/adapters/[channel]/webhook` route in an integration test.
4. Asserting the internal state matches what the CLI-fired payload would produce.

Every adapter PR adds fixtures + regression tests to this suite. When any adapter's payload shape changes (marketplaces DO this), the fixture update is the ADR-quality artifact.

---

## Cross-cutting infrastructure

Two things apply across all adapters and are worth landing in a shared PR early in the module (before Amazon):

**M6-shared-A: `channel_settings` table** (~200 LOC).

```sql
create table channel_settings (
  channel_id      text primary key references channels(id),
  reconciliation_window interval not null default interval '7 days',
  finding_tolerance_cents integer not null default 5,
  finding_tolerance_bps integer not null default 10,
  stock_sync_enabled boolean not null default false,
  price_sync_enabled boolean not null default false,
  webhook_hmac_scheme text,                          -- 'sha256_body' etc.
  notes           text
);
```

Consumed by Module 5 for per-channel reconciliation windows, by Module 6 for feature flags per channel.

**M6-shared-B: adapter observability** (~300 LOC). One place shows per-channel: inbound event rate, translation-failure rate, outbound sync rate, OAuth refresh status. `/admin/adapters` page reading a couple of aggregate views over `adapter_events` and outbox tables.

---

## Deliberate deferrals

- **Non-web marketplaces** (Instagram Shopping, YouTube Shopping, brick-and-mortar POS integrations). Different fulfillment model, different shape.
- **International tax (VAT, GST)** — belongs to Module 5's currency + tax discussion.
- **Multi-region shipping fulfillment** — 3PL split by region. This is a Van Nuys ops call, not an adapter concern.
- **Wholesale/B2B channels** (Faire, Ankorstore) — different pricing model, different order semantics. Later module.

---

## Open questions

1. **Should adapters run in the same Worker as the main app or as separate Workers?** Same Worker is simpler; separate lets us rate-limit and rotate independently. Recommendation: **same Worker until we hit a Cloudflare per-Worker CPU limit** (unlikely for a while).
2. **Retry policy variance per marketplace.** Amazon backs off aggressively; TikTok retries forever. Encode per-channel in `channel_settings.retry_policy_json`.
3. **Which marketplace payload schemas are worth writing static TS types for vs. `zod.record()` + runtime parse?** Recommendation: **static types for anything we send outbound** (catalog updates), **runtime-parsed for inbound webhooks** (their schemas change without notice).

---

## Landed

_This section fills in with merged PR numbers as adapters ship._
