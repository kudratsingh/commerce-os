# Module 7 — The AI Layer (a pattern, not a module)

**Serves:** every team · **Builds on:** everything above, particularly the NL query safety pattern from PR #3 (ADR-007).

**One-liner from `ROADMAP.md`:** the guardrail is everywhere — the model proposes, typed validation disposes; models never touch SQL or money paths.

Module 7 does not ship as one quarter. It lands **continuously**, inside every other module, following the same discipline: the model produces structured output, zod validates, a hand-written function acts.

---

## The pattern (the whole module in one paragraph)

Every AI capability in Commerce OS obeys:

1. **The model emits a typed structure**, never free-form action. Filter specs, JSON draft rows, ranked lists, classification tags — never SQL, never money transfers, never a POST to a route.
2. **A strict zod schema validates.** Extra keys refused (`.strict()`). Every field enumerated. Money and quantities integer.
3. **On zod failure, one repair round-trip** with the specific validation errors. On second failure, hard error to the operator. This is the "one retry" pattern from PR #3.
4. **A hand-written adapter runs the validated structure** against real domain functions. The set of things the model can influence is exactly the set of branches in this adapter — the code shape IS the allowlist.
5. **The raw model reply is preserved** in the audit trail. Displayed in the UI so the safety story is visible.

The rest of this doc lists WHERE to apply this pattern per module. Each is one PR or a series of small PRs slotted into the module that owns the data.

---

## Where the AI layer lands, module by module

### In Module 1 (Purchasing & Replenishment)

**Reorder-point copilot.** Model reads current `stock_levels`, velocity, seasonality, lead time. Emits a proposed `reorder_points` row per SKU with justification. Ops approves per row. Zod schema mirrors `reorder_points`.

**Sourcing search.** "Find me alternate suppliers for VC-BT-100 with lead time < 21 days and MOQ under 500." Model does open-web research (via a tool call, not free browse), returns a ranked list of candidate `suppliers` rows. Human approves before it becomes a `suppliers` insert.

Scoped as **PR M1-F** or slotted into a later polish PR.

### In Module 6.a (TikTok Shop adapter)

**Listing copy generation.** Given a product row, the model drafts TikTok-optimized title + description + bullet points + hashtags. Structured output = a `channel_listings` row plus a metadata blob. Never posts directly to TikTok — always human review first, then goes through the outbound catalog sync.

**Comment triage classifier.** For active livestreams: incoming TikTok comments classified as `question | complaint | purchase_intent | spam | positive`. Human moderators see triage suggestions. Model output = one label + confidence. Never auto-removes a comment.

### In Module 6.b+ (other marketplaces)

**Category-specific listing copy** for Amazon (bullet points), Walmart (structured attributes), eBay (title token optimization). Same pattern per marketplace — different schema, same discipline.

### In Module 4 (Creator & Affiliate Ops)

**Outreach personalization at creator scale.** Given a `creators` row + our brand, the model drafts an initial outreach message + suggested product samples. Human reviews before sending. Model output = a `creator_touchpoints` row with `direction='outbound'` and a message body.

**Attribution disambiguator.** When multiple attribution sources conflict for the same order, the model reads the raw signals and proposes a primary source with a confidence score. Zod schema enumerates the valid `source` values.

**Anomaly narration.** "Voltcore GMV is 40% under trend today; likely causes ranked:" — model reads the last 30 days of `stream_snapshots`, `video_snapshots`, `orders`, `stock_movements` and produces a ranked list of hypotheses with supporting queries (which run through the same NL layer). Structured output = a list of {hypothesis, supporting_view_name, confidence} triples.

### In Module 2 (Live Floor Control Room)

**Cue-card generation.** Given a `stream_segments` schedule and product details, model drafts host talking points per segment. Structured output = one draft per segment, human-edited before airtime.

**Live segment recap generation.** After a stream ends, model reads `stream_snapshots`, `stream_segments`, and orders to write a producer's recap paragraph. Optional; nice-to-have.

**DM triage** — mirror of the comment triage from 6.a, applied to DMs.

### In Module 3 (Brand Portal)

**Weekly digest narrative.** The `brand_digests.payload` currently structured JSON. The model produces a 2-3 paragraph narrative summary that sits above the numbers. Same zod-validated structured input (the digest payload), structured output (paragraph + highlighted metric refs).

### In Module 5 (Settlement Reconciliation)

**Dispute drafting.** When a finding is transitioned to `filed`, the model drafts the case narrative to send to the marketplace's support portal. Structured output = a subject line + body + reference IDs. Human review before send.

---

## Model choice

**Default: `claude-haiku-4-5-20251001`** for anything the UI waits on (NL query, comment triage, quick classifications). Fast + cheap.

**Escalation: `claude-sonnet-4-6-20260212`** (or latest Sonnet) for outputs a human will spend meaningful time reading (listing copy, weekly digest narrative, outreach messages). Quality matters more than latency.

**Not used for anything money-adjacent.** Money paths never see model output — even when we draft dispute filings (M5), the amounts are pulled from `settlement_findings`, not generated.

---

## Infrastructure additions (one-time)

Before the first non-NL AI landing:

**AI Gateway wiring.** Route Anthropic calls through Cloudflare's AI Gateway for caching, rate limiting, per-team spend tracking. Small config change in `lib/domain/nl-query.ts` (client base URL). No schema.

**`ai_generations` audit table.**

```sql
create table ai_generations (
  id              bigint generated always as identity primary key,
  purpose         text not null,                     -- 'nl_query','listing_copy','outreach', etc.
  model           text not null,
  input_hash      text not null,                     -- for dedupe + cache
  input_summary   text,                              -- redacted, ≤ 2 KB
  output_summary  text,                              -- the structured result, ≤ 4 KB
  raw_input_size  integer,
  raw_output_size integer,
  duration_ms     integer,
  cache_hit       boolean not null default false,
  actor           text,                              -- who triggered
  brand_id        uuid references brands(id),
  created_at      timestamptz not null default now()
);
```

Written by every AI-boundary call. Enables per-team dashboards ("this brand cost us $12 in tokens this week") and audit ("show me what the model proposed for finding #4711").

**`ai_prompts` (versioned system prompts).**

```sql
create table ai_prompts (
  id             uuid primary key default gen_random_uuid(),
  purpose        text not null,
  version        integer not null,
  system_prompt  text not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by     text,
  unique (purpose, version)
);
```

Prompts stored + versioned so ADRs point at a stable version. When we change a prompt for `listing_copy`, a new row supersedes; the old prompt remains queryable for reproducibility of past outputs.

---

## Guardrails codified

Every AI-touching PR checklist gains three items (added to `.github/pull_request_template.md` in the first Module 7 landing):

- [ ] Model output goes through a `.strict()` zod schema — extra keys refused.
- [ ] Failure path: one repair round-trip, then hard error surfaced to the operator.
- [ ] No money-adjacent field is derived from model output (amounts, quantities, prices).

Any PR that can't check all three needs an ADR explaining why.

---

## Per-capability PR shape

Each AI capability is 200-500 LOC — usually a new schema for the structured output, a small route, and a UI slice that displays the raw model reply for audit. Total across all modules: ~15-25 landings.

**Not one big Module 7 PR.** The pattern is the discipline; the code lands where the data lives.

---

## Testing

- **Unit tests on every zod schema** with negative cases: extra keys refused, unknown enums refused, non-integer money refused.
- **Snapshot tests on system prompts** — if a prompt in `ai_prompts` changes, the diff is the PR.
- **Cost regression** — a metric on `ai_generations` (tokens per week per purpose) alerts if a prompt change 10× cost.
- **NEVER hit the real API in CI.** Mock the Anthropic client at the boundary (same discipline as `tests/integration/nl-query.test.ts` — only the schema + adapter are tested, not the network call).

---

## Deliberate deferrals (across all AI work)

- **Fine-tuned or hosted models.** No custom training — the pattern relies on strong general models. Revisit only if a specific capability underperforms consistently.
- **RAG over merchant knowledge base.** Not until the knowledge base exists in structured form.
- **Multi-turn agents.** Only for the "one repair round-trip" already in the pattern — no free-form multi-step reasoning against production data.
- **Voice / vision.** Not on the roadmap; punt until asked for.

---

## Open questions

1. **Prompt storage: DB row (current plan) or git-committed markdown?** DB gives runtime versioning without redeploy; git gives code-review workflow. Recommendation: **both** — prompts live in `ai_prompts` (source of truth), but every prompt change comes as a PR that also updates a snapshot markdown under `docs/prompts/[purpose].md`. Zod-parseable frontmatter links the two.
2. **Fallback if Anthropic is degraded.** Currently the NL query 503s cleanly. Longer-term, add a `provider` field to `ai_generations` so we can rotate to another provider (OpenAI, Gemini) without schema changes. Same shape; different SDK.
3. **Per-brand cost caps.** Not per-user but per-`brand_id`. Enforced via `ai_generations` rollup + a `brands.ai_monthly_budget_cents` column. Added when the first brand hits an unreasonable bill.
4. **Prompt injection defenses.** The NL query bar takes ops-team input, not end-user input — low blast radius today. When Module 3's brand portal exposes AI features to external users, add explicit prompt-injection tests + a `system_prompt.injection_defense` block. Named here so we don't forget.

---

## Landed

_This section fills in per capability as they land inside each module's PR chain._
