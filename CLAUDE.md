# CLAUDE.md — Commerce OS

Hardened multi-brand inventory + order ledger for marketplace commerce (TikTok Shop et al).
Interview proof-of-concept for Platinum Commerce. Stack mirrors theirs: Next.js (App Router, TypeScript)
via OpenNext on Cloudflare Workers, Supabase Postgres, supabase-js with
generated types, zod, shadcn/ui, Vitest.

Deep documentation lives in `docs/` — read on demand, don't guess:

| Read this | When |
|---|---|
| `docs/domain-model.md` | What any request means in the real world (business purpose) |
| `docs/architecture.md` | Before any structural change, new table, or new flow |
| `docs/technology-primer.md` | Unfamiliar API in Workers / Supabase / Next.js / zod |
| `docs/engineering-workflow.md` | Branching, PRs, CI/CD, release questions |
| `docs/adr/` | Before changing anything an ADR covers — update or supersede the ADR |
| `BUILD_PLAN.md` | Daily scope, demo script, what is deliberately out of scope |
| `ROADMAP.md` | Module sequencing + metric definitions when building beyond the core |

## Commands

```bash
pnpm dev                 # next dev — fast local loop
pnpm preview             # opennextjs-cloudflare build + wrangler dev (real workerd)
pnpm deploy              # opennextjs-cloudflare build + wrangler deploy
pnpm build               # production build (must pass before any PR)
pnpm lint                # eslint
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest unit tests
pnpm test:integration    # vitest against local Supabase (needs supabase start)
supabase start           # local stack (db on 54322, api on 54321)
supabase db reset        # drop + reapply all migrations + seed
supabase migration new <name>   # new migration file (never edit applied ones)
pnpm gen:types           # supabase gen types typescript --local (rerun after EVERY migration)
psql "$LOCAL_DB_URL" -f db/tests/invariants.sql   # the 6 invariant tests, all must PASS
```

## Non-negotiable invariants (violating any of these is a bug, full stop)

1. `stock_movements` is APPEND-ONLY. Never write UPDATE or DELETE against it,
   never disable its trigger, never "fix" a row — corrections are new
   `adjustment` movements with a note.
2. `stock_levels.on_hand` and `.committed` are ONLY mutated by the domain
   functions (`receive_po_line`, `allocate_order`, `ship_order`, `cancel_order`).
   App code never updates these columns directly.
3. The oversell firewall `CHECK (committed <= on_hand)` stays. If a feature
   "needs" it removed, the feature is designed wrong.
4. Every webhook handler is idempotent. Dedupe via `webhook_events` unique
   constraint with `ON CONFLICT DO NOTHING`; duplicates return 200 `{deduped:true}`.
5. All money is integer cents. No floats anywhere near money or quantities.
6. Every external payload (webhooks, NL query specs, env vars) passes zod
   `safeParse` before touching the database. No unvalidated `any` crosses a boundary.
7. The NL query feature NEVER generates SQL. Model emits a filter spec, zod
   validates it, our query builder maps it to typed supabase-js filter chains.
8. `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never import it into anything
   reachable from the client bundle; client gets anon key + RLS only.
9. Timestamps are `timestamptz`, UTC in the database, formatted at the edge.

## Code conventions

- TypeScript strict mode. `any` is banned; use `unknown` + narrowing.
- Server components fetch read models (views) via the server Supabase client.
  Mutations go through route handlers or server actions that call Postgres
  RPCs — domain logic lives in the database, not in TS.
- supabase-js with generated types (`lib/db/database.types.ts`) for reads and
  simple writes; domain mutations via `.rpc()`. Raw SQL only in migrations and
  `db/tests/`. No ORM.
- File layout: `app/` routes, `lib/db/` (clients, generated types), `lib/domain/`
  (RPC wrappers, zod schemas), `lib/simulator/` (payload factories, signing),
  `components/` (shadcn-based), `supabase/migrations/`, `db/tests/`.
- Errors: never swallow. Webhook pipeline failures increment `attempts`, set
  `last_error`, and surface in the DLQ panel.
- Keep components server-first; `"use client"` only where interactivity requires.

## Workflow rules (apply in every session)

- Never commit to `main`. Branch per task: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Conventional commits (`feat: …`, `fix: …`, `test: …`, `docs: …`).
- Before any commit: `pnpm lint && pnpm typecheck && pnpm test` must pass.
- Open PRs with `gh pr create` using the template; fill the invariants
  checklist honestly. Squash merge only.
- A change that alters a guarantee, interface, or dependency needs an ADR
  (new or superseding) in the same PR.
- Migrations: additive only during this sprint; every migration must apply
  cleanly on `supabase db reset` from zero.
- After schema changes: run the invariant tests and paste the PASS lines into
  the PR description.

## Environment gotchas

- Workers runtime is workerd (V8 isolates), not Node: set
  `compatibility_flags = ["nodejs_compat"]` in wrangler config. No in-memory
  state survives between requests — anything durable lives in Postgres.
- All app data access goes over HTTP via supabase-js (PostgREST + `.rpc()`).
  Never open raw TCP Postgres connections from the Worker; if raw SQL from
  compute is ever truly needed, that is what Hyperdrive is for.
- Cron Triggers (`triggers.crons` in wrangler config) minimum granularity is
  1/min and firings can overlap; sweeper and reconciliation must be re-entrant.
- Secrets: `wrangler secret put` for deployed envs, `.dev.vars` (gitignored)
  locally. Never in wrangler.jsonc, never in the client bundle.
- After every migration, rerun `pnpm gen:types` or TypeScript lies about the schema.
- Supabase Realtime requires tables in the `supabase_realtime` publication;
  if the live feed is silent, check the publication before debugging client code.
- Local Supabase Studio is on http://127.0.0.1:54323 — use it to inspect state
  when a test fails before adding debug code.

## Demo discipline

This repo is walked live in an interview. Optimize for legibility over
cleverness: clear names, small files, comments that explain WHY. Anything
that can't be explained at a whiteboard in two minutes gets simplified.
