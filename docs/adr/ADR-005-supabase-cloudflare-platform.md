# ADR-005: Supabase + Cloudflare Workers as the platform

**Status:** Accepted (supersedes the initial Vercel assumption) · **Date:** Day 0

## Context
Round one intel initially suggested Vercel; corrected recollection plus the
JD itself ("Next.js and TypeScript, Postgres, Cloudflare Workers,
event-driven pipelines, and serverless automation") confirm the platform is
**Cloudflare Workers**. The demo must prove judgment on their platform.
Team size: one engineer plus contractors.

## Decision
- **Compute:** Cloudflare Workers. Next.js (App Router) deployed via the
  official OpenNext adapter (`@opennextjs/cloudflare`), scaffolded with
  `npm create cloudflare@latest`.
- **Data:** Supabase Postgres, accessed from the Worker exclusively over
  HTTP via supabase-js (PostgREST for reads, `.rpc()` for domain functions).
  No raw TCP from isolates; Hyperdrive is the documented answer if raw SQL
  from compute is ever needed.
- **Async:** Workers Cron Triggers for the outbox sweep and reconciliation.
- **Realtime:** browser subscribes directly to Supabase Realtime — the
  Worker is not in that path at all.

## Risk gate (Day 1, hour 1)
Deploy hello-world Next.js to Workers immediately. If the OpenNext adapter
consumes more than two hours of fight, fall back to a **Hono API Worker +
Vite React static assets** — more Workers-idiomatic, zero adapter risk,
identical architecture underneath. Both paths are acceptable outcomes; the
gate exists so the sprint never stalls on packaging.

## Known constraints accepted
- workerd runtime: `compatibility_flags = ["nodejs_compat"]`; no in-memory
  state between requests — durability lives in Postgres by design.
- Bindings model: secrets/env arrive as bindings (`wrangler secret put`,
  `.dev.vars` locally).
- Cron Triggers: 1/min floor, possible overlap → re-entrant jobs.
- CPU-time limits on isolates → heavy work belongs in Postgres or future
  Queue consumers, not in request handlers.

## Alternatives rejected
- **Vercel:** superb Next.js DX, but not the employer's platform; the point
  of the demo is judgment on theirs.
- **Author's comfort stack (FastAPI/ECS/Terraform):** wrong signal, wrong
  ops load for a team of one.

## Revisit when
Long-running or CPU-heavy jobs outgrow isolates → add Cloudflare Queues
consumers or one small always-on worker reading the same outbox. Note the
proof already banked: this ADR was rewritten from Vercel to Workers and the
entire database layer — schema, functions, tests, CI — did not change one
line. Postgres-centric truth makes the compute layer swappable, which is the
architecture's central claim.
