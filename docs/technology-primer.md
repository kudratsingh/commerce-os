# Technology Primer — New Stack, Mapped to What You Already Know

Every technology here is a repackaging of something you've built by hand on the
incident platform. Learn the mapping, not the tool from scratch. Each section:
what it is, what it replaces in your world, what you'll actually touch this
week, and the trap to avoid.

Quick map:

| This project | Your incident platform | Mental model |
|---|---|---|
| Supabase | Postgres 16 + auth + infra you ran on ECS | Managed Postgres with batteries |
| Supabase RLS | Your tenant-scoped auth + query filtering | Tenant filter enforced by the DB itself |
| Supabase Realtime | SSE endpoint + Redis pub/sub fan-out | Logical replication → websocket, managed |
| Cloudflare Workers | ECS Fargate + ALB + Terraform | V8 isolates in 300+ cities; git push = deploy |
| Workers bindings | Env vars + IAM roles + client configs | Platform resources injected into your handler |
| Cron Triggers | Your scheduled Kafka consumers / pg_cron | HTTP ping on a schedule; job must be re-entrant |
| Next.js App Router | React SPA + FastAPI, fused | The page IS the backend-for-frontend |
| Route handlers | FastAPI endpoints | Same thing, running in the Worker |
| supabase-js + gen types | Pydantic models over your REST client | Typed client generated FROM the schema |
| zod | Pydantic | Identical philosophy, parse at the boundary |
| HMAC webhook auth | Your scoped service-account JWTs | Shared-secret signature per request body |

---

## Cloudflare Workers (the big platform shift)

**What it is.** Your code runs in **V8 isolates** — the lightweight sandboxes
Chrome uses for tabs — on Cloudflare's edge network, not in containers or VMs.
Startup is near-instant, so there's no cold-start dance, and your Worker runs
close to whoever calls it. The runtime is `workerd`, not Node; with
`compatibility_flags = ["nodejs_compat"]` most Node APIs work, but the mental
model is "browser-grade JS with fetch, Web Crypto, and streams" first.

**What it replaces for you.** Everything Terraform + ECS + ALB did, collapsed
into `wrangler deploy`. Config lives in `wrangler.jsonc` (routes, cron, flags,
bindings) — your entire infra-as-code footprint is now one small JSON file in
the repo.

**Bindings (the one genuinely new concept).** Workers don't reach out to
platform resources with SDKs and credentials the way your ECS tasks did.
Resources are **bound** to the Worker in config and injected into your handler
as `env.WHATEVER`: secrets, KV namespaces, R2 buckets, Queues, D1 databases.
Think dependency injection at the platform level. This week you'll only bind
secrets (`wrangler secret put WEBHOOK_SHARED_SECRET`, mirrored locally in a
gitignored `.dev.vars`), but know the pattern — it's how everything on the
platform composes.

**Cron Triggers.** `triggers.crons = ["* * * * *"]` in wrangler config fires
your scheduled handler every minute. Floor is 1/min, overlap is possible —
hence the re-entrant sweep design (same discipline as your Kafka consumer
rebalances: assume you can be called twice).

**Statelessness, sharpened.** Your FastAPI workers were long-lived; you could
cache in memory, hold connections, run background threads. Isolates can be
created and evicted at any time, per-request. Anything that must survive lives
in Postgres — which is why the outbox carries all async state and why this
constraint costs the design nothing.

**Next.js on Workers: OpenNext.** Next.js isn't native here; the official
adapter `@opennextjs/cloudflare` compiles the Next build into a Worker.
`npm create cloudflare@latest` scaffolds it wired up. Dev loop: `next dev` for
fast iteration, `pnpm preview` (build + `wrangler dev`) as a daily fidelity
check on real workerd, `wrangler deploy` to ship. ADR-005 has the hour-one
gate and the Hono fallback if the adapter fights.

**The trap.** Debugging on `next dev` all week and discovering workerd
differences on demo eve. Run the preview check daily; deploy daily.

**Platform vocabulary that will land in the interview** (know what they are,
propose them for the roadmap, use none of them this week):
- **Durable Objects** — single-threaded stateful coordination points. The
  natural home for a per-live-bay real-time GMV counter: nine studios, nine
  objects, zero race conditions. This one maps so directly onto Platinum's
  live floor that it's worth a sentence in the demo close.
- **Queues** — managed at-least-once delivery with batching and native dead
  letter queues; the on-platform graduation path for the outbox sweep (ADR-002).
- **Hyperdrive** — Postgres connection pooling/acceleration from Workers, the
  answer if raw SQL from compute is ever needed.
- **AI Gateway / Workers AI** — caching, rate limiting, and observability in
  front of model calls; relevant to their "AI-powered tooling" line.

## Supabase

**What it is.** Managed Postgres plus auth (GoTrue), auto-generated REST
(PostgREST), Realtime (logical replication over websockets), storage, edge
functions. Treat it as exactly what it is underneath: Postgres 16 you already
know, with a dashboard.

**What you'll touch this week.** The CLI (`supabase start`, `db reset`,
`migration new`, `gen types`), Studio for inspection, and `@supabase/supabase-js`
in two flavors: anon-key client in the browser (RLS applies), service-role
client in the Worker (bypasses RLS — treat it like your platform's admin token).

**The data path, and why it's clean on Workers.** supabase-js speaks HTTP
(PostgREST), so the Worker never opens a TCP connection to Postgres — the
entire pooling problem class (your asyncpg pool tuning, pgbouncer modes)
vanishes. Reads hit tables and views; domain mutations call your Postgres
functions via `.rpc('allocate_order', {...})`. One rule: after every
migration, rerun `supabase gen types typescript` so the TypeScript types are
generated from the real schema — the same "types can't drift from truth"
discipline as your Pydantic models, but pointed at the database.

**RLS as the tenant boundary.** On the incident platform you enforced tenancy
in query code. Here the policy lives on the table: a brand-scoped JWT can't
cross brands even through a buggy query. Internal ops dashboards run
server-side with the service role on purpose; the future per-brand client
portal is where RLS earns its keep.

## Next.js App Router (the big mental shift)

On the incident platform: React SPA calls FastAPI over HTTP, you manage the
seam. Here the seam mostly disappears:

- **Server components (default):** async React components that run in the
  Worker, query Supabase directly, and render HTML. Your dashboard pages are
  `async function Page()` that `await` queries — "a FastAPI handler that
  returns JSX instead of JSON."
- **Client components (`"use client"`):** the React you know. Only for
  interactivity: the Realtime feed, chaos buttons, NL query bar. Keep them
  small, at the leaves.
- **Route handlers** (`app/api/.../route.ts`): literal FastAPI equivalents —
  `export async function POST(req: Request)`. Webhooks, cron targets, NL
  query. One nuance for HMAC: read the **raw body** (`await req.text()`)
  before any JSON parsing and verify against that exact string.
- **Server actions:** functions marked `"use server"` callable from
  components as if local. Use for DLQ Retry and reconciliation Run buttons;
  skip for anything the simulator must hit over real HTTP.

**The trap:** reaching for `useEffect` + `fetch` to load page data,
SPA-style. Fetch in the server component, pass data down.

## zod (you already know this, it's Pydantic)

| Pydantic | zod |
|---|---|
| `class Order(BaseModel)` | `const Order = z.object({...})` |
| `field: int = Field(gt=0)` | `z.number().int().positive()` |
| `Order.model_validate(data)` raises | `Order.parse(data)` throws |
| `try/except ValidationError` | `Order.safeParse(data)` returns `{success, ...}` |
| `@field_validator` | `.refine()` / `.superRefine()` |
| `model_dump()` | the parsed value is already plain data |

Use `safeParse` at every boundary (webhooks, NL specs, env). Infer TS types
from schemas (`z.infer<typeof Order>`) so validation and types can't drift —
your Pydantic JobFilterSpec discipline, ported. Note the division of labor:
zod validates data crossing the wire; the generated Supabase types describe
data at rest. They meet in the webhook pipeline and should agree.

## Supabase Realtime

Your incident platform chain — event → Redis pub/sub → SSE endpoint →
EventSource client, all hand-built — collapses to:

```ts
supabase.channel("orders-feed")
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "orders" },
      (payload) => prependToFeed(payload.new))
  .subscribe();
```

Under the hood it tails logical replication (same mechanism as Debezium CDC,
which you can cite). The browser talks straight to Supabase — the Worker is
not in this path, so nothing about the platform shift touches it. Two traps:
the table must be in the `supabase_realtime` publication (silent nothing
otherwise), and RLS applies to what the anon client may stream — add the read
policy deliberately and say it was deliberate.

## HMAC webhook signatures

Your platform authenticated clients with scoped JWTs. Marketplaces instead
sign each delivery: `signature = HMAC_SHA256(shared_secret, raw_body)`.
On Workers, Web Crypto is the native tool (`crypto.subtle.importKey` +
`crypto.subtle.sign`), with `timingSafeEqual` available under nodejs_compat
for constant-time comparison — never compare signatures with `===`. The
simulator signs with the same helper the verifier uses, so the demo exercises
the real check, and TikTok Shop's real webhooks follow this same shape.

## Suggested first-hour warmup (Day 1, before feature code)

1. `npm create cloudflare@latest` → Next.js template → `wrangler deploy`
   hello-world. This is the ADR-005 risk gate; retire it first.
2. `supabase start`, open Studio, run the invariant tests by hand, watch them
   pass. Run `supabase gen types typescript --local` and skim the output.
3. Make one server component render `stock_levels` — feel the "page queries
   the DB" model.
4. Subscribe to `orders` inserts in a client component, insert a row in
   Studio, watch it appear. That loop is the whole Realtime story.
