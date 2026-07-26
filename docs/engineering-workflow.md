# Engineering Workflow — Git, CI/CD, and How It Scales to a Team

This repo runs a real professional workflow even though one person builds it in
five days. That's deliberate: the repo itself is the answer to "how would you
manage the overseas developers." Every practice below exists twice — once as a
rule, once as the reason it protects quality when contractors join.

---

## 1. Branching model: trunk-based, short-lived branches

- `main` is protected: no direct pushes, PRs only, CI must be green, linear
  history via squash merge.
- One branch per task, hours-to-a-day in scope, named by intent:
  `feat/webhook-ingestion`, `feat/chaos-panel`, `fix/dedupe-status-code`,
  `docs/adr-outbox`, `chore/ci-pipeline`.
- Rebase on main before opening the PR; delete branches on merge.
- No long-lived feature branches, no develop branch, no gitflow. Five days of
  work should merge to main at least 3–4 times a day.

**Team translation:** contractors get small, unambiguous branch scopes. A
branch that lives more than two days is a task that was cut wrong — the fix
is decomposition, not a bigger merge.

## 2. Commits: conventional, atomic

Format: `type(scope): imperative summary` — types: `feat`, `fix`, `test`,
`docs`, `chore`, `refactor`.

```
feat(ingest): dedupe webhook events on (channel, external_event_id)
fix(ingest): return 200 not 409 on duplicate delivery
test(domain): prove partial allocation rolls back on insufficient stock
docs(adr): ADR-004 idempotency strategy
```

Each commit compiles and passes tests on its own. The history should read as
the build log of the system.

**Team translation:** conventional commits make review triage and changelog
generation free, and force contractors to think in one-change units.

## 3. Pull requests

Every change lands via PR using `.github/pull_request_template.md`:

- **Summary** — what and why, two sentences.
- **Invariants checklist** — did this touch the ledger, stock_levels,
  idempotency, or money handling? Each touched invariant gets a line on how
  it's still protected.
- **Test evidence** — paste the relevant PASS lines (unit + invariant SQL).
- **ADR** — link the ADR if a guarantee/interface/dependency changed.
- **Screenshots** — for any UI change.

Self-review discipline (solo mode): open the PR, read the diff top to bottom
as a reviewer, run Claude Code review on it, fix, then squash-merge. Never
merge a PR you haven't re-read in the GitHub diff view — the diff view
catches what the editor hides.

**Team translation:** the template becomes the contract with contractors. The
invariants checklist is how a reviewer in LA protects the ledger from a
well-meaning shortcut written at 3am in another timezone. Review SLAs: <24h
turnaround, blocking comments must name the rule they enforce (link CLAUDE.md
or an ADR, not taste).

## 4. CI — `.github/workflows/ci.yml`

Two jobs on every PR and push to main:

**Job 1: quality** — `pnpm install → lint → typecheck → unit tests → build`.
Fails fast, ~2 minutes. Nothing merges with a red build, no exceptions, no
"fix it in the next PR."

**Job 2: db-invariants** — spins a `postgres:16` service container, stubs the
Supabase `auth` schema, applies every migration from zero in order, then runs
`db/tests/invariants.sql` and fails the build if any line says FAIL. This job
answers two questions forever: "do migrations apply cleanly from scratch?"
and "do the six hardening guarantees still hold?" A contractor cannot merge
code that breaks the oversell firewall even if no human notices.

**Team translation:** CI is the only reviewer that never gets tired and never
gets argued with. Standards live in pipelines, not in Slack messages.

## 5. CD — Cloudflare Workers + migrations

- **App:** GitHub Actions with the official `cloudflare/wrangler-action`.
  Merge to main runs the OpenNext build and `wrangler deploy` to production.
  On PRs, `wrangler versions upload` publishes a preview version with a
  shareable URL (Cloudflare's Workers Builds can automate the same per-PR
  flow) — used for demo rehearsal and for showing work without a meeting.
- **Database:** migrations are applied explicitly with `supabase db push`
  against the linked project, immediately before merging the PR that needs
  them, additive-only during the sprint (expand/contract if a rename is ever
  truly needed). This is a conscious manual step this week; the automated
  path (a deploy workflow with `SUPABASE_ACCESS_TOKEN` applying migrations on
  main) is documented so the team can adopt it in week one of the real job.
- **Environments:** local (`supabase start` + `.dev.vars`) → preview versions
  (pointed at the same dev Supabase project) → production Worker. Secrets live
  in `wrangler secret` / the Cloudflare dashboard; `.dev.vars` is gitignored;
  no secret has ever been a string literal in this repo.

**Deploy order rule** (the one that prevents the classic outage): database
first, app second, and the app must run against both the old and new schema
for one deploy cycle. Additive migrations make this automatic.

## 6. Definition of done

A task is done when: code merged to main via green PR, tests cover the new
behavior, invariants job green, ADR updated if a decision changed, demo-able
from the deployed preview, and CLAUDE.md updated if a new "always/never" rule
emerged. Not before.

## 7. Release hygiene for demo day

- Tag the rehearsed state: `git tag demo-v1` — the demo runs from a tag, not
  from whatever main became overnight.
- `pnpm seed:demo` resets the database to a known state with realistic
  history (a few shipped orders so charts aren't empty).
- Record a 2-minute screen capture of the full chaos sequence as the backup
  for hostile wifi.

## 8. The interview answer this file encodes

When asked "how would you run the overseas developers," the answer is a tour
of this doc: small scoped branches, conventional commits, a PR template whose
checklist enforces the invariants, CI that makes the guarantees unbreakable
by merge, preview deployments so anyone can see work without a meeting, and
ADRs so decisions survive people. Then the close: "none of this is
aspirational — it's how this repo was built last week, solo, under a
deadline. The standards don't relax when it's just me, which is exactly why
they'll hold when it isn't."
