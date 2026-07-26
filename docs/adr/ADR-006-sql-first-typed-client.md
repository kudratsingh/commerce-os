# ADR-006: SQL-first migrations; supabase-js with generated types as the query layer

**Status:** Accepted (supersedes Drizzle variant) · **Date:** Day 0

## Context
The JD says it plainly: "you design schemas and write performant SQL, not
just call an ORM." The schema IS the product — constraints, triggers, and
functions carry the guarantees. Separately, the compute platform is Workers
(ADR-005): V8 isolates make HTTP the idiomatic data path, and every TCP
pooling concern disappears if the app never opens a socket to Postgres.

## Decision
- Migrations are hand-written SQL under `supabase/migrations/`, applied by
  the Supabase CLI, reviewed like code. Never edit an applied migration.
- The app's data layer is **supabase-js + generated types**:
  `supabase gen types typescript` after every migration keeps TypeScript's
  view of the schema honest. Reads hit tables and views through PostgREST;
  domain mutations go through `.rpc()` into the Postgres functions (ADR-003).
- No ORM. Drizzle (over Hyperdrive) is the documented upgrade if complex
  dynamic joins ever outgrow PostgREST — a swap of the read layer only.

## Alternatives rejected
- **Prisma:** its schema DSL wants to own the database; triggers, CHECKs,
  partial indexes, and plpgsql become escape hatches. Heavy on isolates.
- **Drizzle now:** solid, but adds a TCP driver + pooling story on Workers
  and a second schema representation to maintain — surface without payoff
  at this table count and timeline.

## Consequences
Type safety depends on the gen-types discipline → encoded in CLAUDE.md and
the PR checklist. Query expressiveness is bounded by PostgREST → domain
functions and views absorb the complex logic, which is where it belonged
anyway (ADR-003).
