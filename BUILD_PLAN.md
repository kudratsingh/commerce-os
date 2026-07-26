# Commerce OS: 5-Day Build Plan

A hardened, multi-brand inventory and order ledger on their exact stack (Supabase, Cloudflare Workers, Next.js, TypeScript), with a chaos-mode marketplace simulator that makes the hardening visible in a live demo.

**Positioning (memorize this framing):** "I wanted to be sure the architecture I'd propose actually works on your stack, so I built a proof of concept of the foundation." Never "better than yours." It's the skeleton of Platinum OS you'd harden and grow, built in 5 days with Claude Code as proof of the AI-native workflow they asked for.

---

## The system in five components

1. **The ledger core** (done, in `db/`): append-only `stock_movements` as physical truth, `stock_levels` rollup with a `CHECK (committed <= on_hand)` oversell firewall, atomic `allocate_order` / `ship_order` / `receive_po_line` functions, multi-brand RLS. Verified by `003_invariant_tests.sql` (all passing on Postgres 16).
2. **Ingestion pipeline**: a `/api/webhooks/tiktok` route with HMAC signature verification, event-level dedupe via `webhook_events` unique constraint, order upsert, SKU resolution through `channel_listings`, allocation, outbox write. Failed events retry with backoff, then land in a DLQ view.
3. **Marketplace simulator with chaos mode**: a control panel that fires signed webhooks at your own endpoint. Buttons: Send order, Send duplicate, Burst 50, Malformed payload, Bad signature, Skew channel inventory report. This substitutes for real TikTok Shop API access (partner approval takes weeks, say so plainly) and turns invisible hardening into a visible demo.
4. **Live ops dashboard**: Supabase Realtime order feed, GMV-today tickers per brand/channel, stock table (on_hand / committed / available with low-stock badges), DLQ panel with retry, reconciliation findings panel with a Run button.
5. **NL ops query**: "show Voltcore orders over $100 today" → Claude → zod-validated filter spec → query builder → results table. Your Pydantic JobFilterSpec pattern ported to TypeScript: the model proposes, zod disposes.

**Deliberately out of scope (say this list out loud when asked, it shows judgment):** real marketplace APIs, returns UI, transfers, client portal, payments, shipping labels, accounting sync, real auth beyond a single ops login. Schema supports several of these already; UI does not.

---

## Stack decisions (one-line whys, ready for "why did you choose X")

| Choice | Why |
|---|---|
| Next.js App Router + TS via OpenNext on Cloudflare Workers | Their stack, per the JD and what Ashton showed. Server components read via service role; route handlers take webhooks. |
| Supabase Postgres | Their stack, and it is just Postgres, which is my deepest skill. RLS for brand isolation. |
| Raw SQL migrations (Supabase CLI) + supabase-js generated types | Migrations stay reviewable SQL; generated types give end-to-end type safety over PostgREST and `.rpc()`. |
| Domain logic in Postgres functions | Atomicity where the data lives; the oversell guard cannot be bypassed by app bugs. |
| Workers Cron Triggers for outbox sweep + reconciliation | Right-sized async for a team of one. Cloudflare Queues at 10x, Kafka at 100x, and I can name the trigger points. |
| zod everywhere at the boundary | Webhook payloads, NL query specs, env vars. Nothing untyped crosses the edge. |
| shadcn/ui + Tailwind + Recharts | Fast polish that doesn't look templated. Dark theme, dense tables, ops-room feel. |
| Vitest | Port the SQL invariant tests + webhook dedupe tests. Target ~30 focused tests, not 371. |
| Sentry (free tier) | "First thing I install anywhere" is a good line and it's true. |

Platform gotcha to mention unprompted: Workers are V8 isolates, so the data path is supabase-js over HTTP rather than pooled TCP, with Hyperdrive as the answer if raw SQL from compute is ever needed. Knowing this signals real operation of this stack.

---

## Webhook contract (the simulator speaks this; build both sides against it)

```
POST /api/webhooks/tiktok
Headers: x-signature: hex(HMAC-SHA256(secret, rawBody))
{
  "event_id": "evt_01H...",        // dedupe key -> webhook_events unique
  "event_type": "order.created",    // also: order.cancelled
  "occurred_at": "2026-07-22T18:04:11Z",
  "order": {
    "external_order_id": "TTS-8841203",
    "buyer_handle": "@mia.unboxes",
    "placed_at": "2026-07-22T18:04:09Z",
    "lines": [ { "external_sku": "TTS-VC-BT-100", "qty": 1, "unit_price_cents": 7999 } ]
  }
}
```

Processing order (each step idempotent):
1. Verify HMAC on the raw body. Fail → record event with `signature_valid=false`, status `dead`, return 401.
2. `INSERT webhook_events ... ON CONFLICT DO NOTHING`. No row inserted → duplicate → return 200 with `{deduped: true}` (200, not error: the marketplace should stop retrying).
3. Parse with zod. Invalid → status `failed`, attempts++, visible in DLQ.
4. Resolve `external_sku` → product via `channel_listings`. Unknown SKU → DLQ with a clear error (this is a real ops scenario: listing created on marketplace before in system).
5. Upsert order on `(channel_id, external_order_id)`, insert lines, call `allocate_order`, write outbox `order.allocated` or `order.backordered`, mark event `processed`. One transaction.

Chaos buttons map to: duplicate = same `event_id` twice; out-of-order = cancel before create; malformed = drop a field; bad signature = wrong secret; burst = 50 orders with random SKUs/qtys; skew = write `channel_inventory_reports` +N.

---

## Day-by-day

**Day 1 — Foundation.** Repo init (pnpm, Next.js, TS strict, Drizzle, Vitest, CI via GitHub Actions). Supabase project, apply `001_schema.sql` + `002_seed.sql` as CLI migrations. Port `003_invariant_tests.sql` to Vitest against a local Supabase. Write ADR-001 (ledger + rollup + CHECK firewall) and ADR-002 (outbox on Postgres, not Kafka, and the trigger point for changing that answer). Hour-one gate: scaffold with `npm create cloudflare@latest` (Next.js template, OpenNext preconfigured) and deploy hello-world with `wrangler deploy`. If OpenNext fights you for more than two hours, fall back to a Hono API Worker + Vite React assets and do not look back (ADR-005 records both paths).

**Day 2 — Ingestion.** Webhook route per the contract above. Simulator v1 as a script firing signed payloads. Tests: duplicate event is a no-op, duplicate order id is a no-op, bad signature rejected, unknown SKU goes to DLQ, burst of 50 ends with ledger == rollup. Outbox sweeper route + Cron Trigger (every minute) with a manual Run Now button for demos.

**Day 3 — Dashboard.** Layout + dark ops theme. Live order feed via Supabase Realtime (`postgres_changes` on orders). GMV tickers from `gmv_today`. Stock table from `stock_levels` joined to products with low-stock badges. DLQ panel (failed/dead webhook_events) with per-row Retry. Keep every number sourced from a view you can name.

**Day 4 — Chaos + reconciliation + AI.** Simulator becomes an in-app page with the six buttons and a visible counter strip (received / deduped / processed / DLQ). Reconciliation: Run button → `run_reconciliation()` RPC → findings panel with red deltas → Resolve action. NL query bar: Anthropic SDK, system prompt returns only a JSON filter spec, zod parse, reject-and-retry once on invalid, then query. Log every NL query + generated spec to the screen so the safety story is visible.

**Day 5 — Polish + rehearsal.** Seed a fresh demo database. Realistic touches: a few pre-shipped orders so charts have history. README with architecture diagram (Mermaid). Record a 2-minute backup screen capture in case of demo-day wifi. Rehearse the 7-minute script below at least 3 times, once with someone interrupting you. Prepare the one-page leave-behind.

Working style throughout: real PRs even solo, conventional commits, 4 short ADRs total. The repo itself demonstrates the standards you'd impose on the overseas devs.

---

## The 7-minute demo script

1. **(30s) Frame it.** "You told me the inventory and order ledger is manual. I built the foundation I'd propose: same stack you're on, hardened the way marketplace ingestion has to be. Five days, built with Claude Code."
2. **(1m) Dashboard tour.** Live feed, GMV, stock table. "Every number is a SQL view over an append-only ledger. Nothing is a mutable counter."
3. **(2m) Chaos.** Send order → appears live, available decrements. Send the same event again → dedupe counter ticks, nothing double-allocates. Burst 50 → feed streams, GMV climbs, then: "ledger still equals rollup, and here's the reconciliation run proving it." Malformed payload → DLQ → fix narrative → Retry → processed.
4. **(1m) Oversell firewall.** Order qty 9,999 → backordered, no partial reservation. "Even a buggy code path can't oversell: the constraint is in the database."
5. **(1m) NL query.** Type a question, show the generated spec next to the results. "The model proposes, zod disposes. It never writes SQL."
6. **(1m) Repo tour.** Schema file, allocate_order, the test suite green, the ADRs. "This is also how I'd run the overseas team: spec first, tests as the gate, small PRs."
7. **(30s) Close.** "This is a skeleton, not a product. The 90-day plan takes it to your real TikTok Shop integration, receiving flows for Van Nuys, and reporting your account managers stop building by hand."

---

## Whiteboard artifacts to memorize (be able to draw each in under 3 minutes)

1. The ERD spine: PO → receipt → stock_movements → stock_levels ← order_lines ← orders ← webhook_events, with outbox hanging off the transaction.
2. The ingestion sequence diagram including both failure paths (duplicate, DLQ).
3. The allocate_order logic including why the exception block gives all-or-nothing.

## Lines to have ready

- "Supabase is Postgres, and Postgres is my deepest skill. At your volume this stack is right; I can tell you exactly what breaks at 100x and what I'd change then, and nothing sooner."
- "At-least-once delivery in, exactly-once effects out. That's the whole ingestion philosophy."
- "Current stock is never a number somebody typed. It's the sum of an audit trail."
- If asked whether this was AI-generated: "Yes, heavily, that's the workflow you're hiring for. Every design decision is mine, every line reviewed, and the invariant tests prove the properties I claimed. Happy to walk any file."
