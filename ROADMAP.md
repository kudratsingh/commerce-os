# Commerce OS Roadmap — From System of Record to Operating System

The ledger core (this repo) is not the product. It is the ground the products
stand on: every module below reads or writes the system of record, which is
the argument for building it first. Modules are numbered for reference, not
strict order — sequencing gets set with leadership against current pain, and
a suggested sequence is at the end.

---

## Module 1 — Purchasing & Replenishment Intelligence
**Serves:** Purchasing · **Builds on:** `stock_movements`, `stock_levels`, `orders`, `purchase_orders`

In Buy & Sell mode the inventory is Platinum's own capital. The ledger already
knows sell-through velocity per SKU per channel; this module turns it into
decisions: reorder-point alerts ("VC-BT-100 stocks out in 9 days at current
velocity; supplier lead time is 14 — order now"), margin and true P&L per SKU
per channel (marketplace fees and returns included), aged-inventory flags for
capital tied up in stock that stopped moving, and PO lifecycle tracking with
receiving UI — retiring the manual ledger for good. New tables: suppliers,
lead_times, fee_schedules.

## Module 2 — Live Floor Control Room
**Serves:** Live producers, hosts, studio ops · **Builds on:** `orders`, `stock_levels`, Module 4's metrics spine

Nine bays streaming daily is the most distinctive asset in the company and
the least served by generic software. Bay/host/brand scheduling, a real-time
per-stream GMV and conversion board, on-air coupon creation with a kill
switch, and a live available-to-sell feed to the host so no one pitches a
product that sold out two minutes ago — wasted airtime is the most perishable
inventory in the building. Host analytics ($/hour, conversion by category)
fall out of Module 4's data for free. Platform note: one Durable Object per
bay is the natural real-time aggregation point.

## Module 3 — Brand Portal
**Serves:** Brand clients, account managers · **Builds on:** the multi-tenant RLS model, `gmv_today`-style views, Module 4 attribution

Every brand gets a login: their GMV, orders, inventory position, content
produced, upcoming streams, automated weekly digests. Account managers stop
hand-building reports; brands stop churning from an agency they can't see
into. The schema barely changes — this is what brand-scoped RLS was designed
for. Retention feature first, sales-demo asset second.

## Module 4 — Creator & Affiliate Operations
**Serves:** Affiliate managers, sample center, live producers · **Builds on:** `orders` (attribution), `stock_movements` (samples), new metrics spine

A 20,000-creator network run on spreadsheets becomes a CRM with a physical
supply chain attached: outreach pipeline (contacted → replied → accepted),
sample pipeline (request → approval → ship → posted?), commission and
deliverable tracking. Two elegant continuities with the core: a shipped
sample is just a stock movement with reason `sample_sent`, so the sample
center's inventory leak is finally accounted for; and attributed GMV rides
the orders we already ingest via an attribution link (order → creator and/or
stream), not a parallel data source.

### Feature: Performance Intelligence (creators + livestreams)

One metrics spine instruments both creators and streams; Module 2's boards
read from it. Raw facts land in append-only snapshot tables (the ledger
philosophy applied to analytics); every derived metric is a SQL view, so
definitions live in one reviewable place.

**Livestream indicators** (per stream, per bay, per host, per brand):

| Group | Indicators |
|---|---|
| Reach | Total views, unique viewers, peak concurrent (PCU), average concurrent (ACU), entry source split (For You / following / boosted) |
| Retention | Total watch time, avg watch duration, viewer retention curve |
| Engagement | Comments, likes, shares, new followers gained during stream |
| Funnel | Product card impressions → clicks (CTR) → orders (CVR), add-to-cart where available |
| Revenue | GMV, order count, units, AOV, **GPM (GMV per 1,000 views — the canonical TikTok live metric)**, GMV per hour of airtime |
| Merch timing | Per-SKU units sold by minute mapped to pitch segments, time-to-sell-out, coupon redemption rate |
| Paid | Ad spend on boosted streams (GMV Max), ROAS |
| Quality | Cancellation rate, refund/return rate attributed to the stream |
| Ops | Scheduled vs actual airtime, $/hour by host, conversion by host and category |

**Creator/affiliate indicators** (per creator, per video, per campaign):

| Group | Indicators |
|---|---|
| Output | Videos posted, deliverables vs committed, on-time rate |
| Audience | Views, engagement rate, follower growth, view velocity/half-life |
| Conversion | Attributed orders, attributed GMV, GPM per video, CVR on affiliate traffic |
| Economics | Commission paid, effective commission rate, sample units + cost, post-rate after sample, **ROI = attributed GMV ÷ (sample cost + commission)**, GMV per sample dollar |
| Pipeline | Outreach → reply → acceptance rates, time-to-first-post |
| Quality | Return rate on creator-attributed orders, content compliance flags |

**Data model sketch:** `streams`, `stream_snapshots` (time-series ACU/GMV),
`stream_segments` (which product pitched when), `creators`, `creator_videos`,
`video_snapshots`, `attributions` (order → creator/stream/video). Sources:
TikTok Shop and affiliate APIs where partner access allows, CSV import as the
honest fallback for metrics the APIs don't expose, thin manual-entry UI for
studio-side facts (segment timing, host assignment). Ingestion is
idempotent-by-snapshot, same discipline as webhooks.

## Module 5 — Settlement Reconciliation
**Serves:** Finance/ownership · **Builds on:** `orders`, the reconciliation pattern

Marketplace payout files vs expected revenue per order: fee miscalculations,
missed refund clawbacks, unpaid orders. The exact trust-but-verify pattern
already running against inventory, pointed at money. At ~$100M GMV, finding
half a percent of leakage pays for the engineering team.

## Module 6 — Marketplace Expansion & Listing Management
**Serves:** Everyone · **Builds on:** the ingestion contract, `channel_listings`

Real adapters in order of revenue: TikTok Shop, then Amazon SP-API, Walmart,
eBay, Target+. One catalog pushed everywhere; price and available-to-sell
synced out on change; orders synced in through the existing contract. Each
marketplace is an adapter PR against interfaces that already exist — the
simulator becomes the regression harness for all of them.

## Module 7 — The AI Layer (a pattern, not a module)
**Serves:** Every team · **Builds on:** all of the above

NL queries over any module's data (already demonstrated), listing copy
generation per channel, outreach personalization at creator scale, comment
and DM triage, stream recap digests, anomaly narration ("Voltcore GMV is 40%
under trend; likely causes ranked"). Guardrail everywhere: the model
proposes, typed validation disposes; models never touch SQL or money paths.

---

## Suggested sequence

1. **Now (this build):** the ledger core + ingestion + reconciliation.
2. **First quarter:** Module 1 (receiving UI kills the manual ledger; reorder
   alerts protect capital) and the TikTok Shop adapter from Module 6.
3. **Second quarter:** Module 4's CRM + metrics spine, feeding Module 2's
   control room — the two most Platinum-shaped things software can do here.
4. **Then:** Brand portal (3), settlement recon (5), remaining marketplaces
   (6), with the AI layer (7) landing continuously inside each.

Sequencing principle: every quarter ships something a named person uses
daily, and nothing is built twice — each module compounds on the ledger
rather than beside it.

---

## Execution plans

This ROADMAP is the "what and why." The **"how"** — sequenced PRs per module
with schema drops, RPCs, routes, LOC estimates, testing, and deferrals — lives
in [`docs/next-phases/`](./docs/next-phases/). One doc per module, plus an
overview + dependency graph.

| Module | Execution plan |
|---|---|
| 1 — Purchasing & Replenishment | [`docs/next-phases/01-purchasing-replenishment.md`](./docs/next-phases/01-purchasing-replenishment.md) |
| 2 — Live Floor Control Room | [`docs/next-phases/04-live-floor-control.md`](./docs/next-phases/04-live-floor-control.md) |
| 3 — Brand Portal | [`docs/next-phases/05-brand-portal.md`](./docs/next-phases/05-brand-portal.md) |
| 4 — Creator & Affiliate Ops + Metrics | [`docs/next-phases/03-creator-affiliate-ops.md`](./docs/next-phases/03-creator-affiliate-ops.md) |
| 5 — Settlement Reconciliation | [`docs/next-phases/06-settlement-reconciliation.md`](./docs/next-phases/06-settlement-reconciliation.md) |
| 6.a — TikTok Shop adapter | [`docs/next-phases/02-tiktok-shop-adapter.md`](./docs/next-phases/02-tiktok-shop-adapter.md) |
| 6.b+ — Marketplace expansion | [`docs/next-phases/07-marketplace-expansion.md`](./docs/next-phases/07-marketplace-expansion.md) |
| 7 — AI Layer (pattern) | [`docs/next-phases/08-ai-layer.md`](./docs/next-phases/08-ai-layer.md) |

Start with the [overview](./docs/next-phases/README.md) for the dependency
graph and quarterly milestones.
