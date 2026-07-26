# ADR-007: NL queries — the model proposes, zod disposes

**Status:** Accepted · **Date:** Day 0

## Context
Ops staff should ask questions in English ("Voltcore orders over $100
today"). Letting a model write SQL against the system of record is an
injection surface and an correctness hazard, and non-deterministic SQL is
unreviewable.

## Decision
The model's only job is to emit a JSON **filter spec** (brand, channel,
status, date range, amount bounds, limit) matching a zod schema. Pipeline:
prompt → `safeParse` → on failure, one repair round-trip with the validation
errors → on success, a hand-written query builder maps the spec to
typed supabase-js filter chains over an allowlist of fields. The generated spec
is displayed beside the results so every answer is auditable.

This ports the incident platform's Pydantic `JobFilterSpec` pattern verbatim,
with zod in Pydantic's seat.

## Alternatives rejected
- **Model-generated SQL (even read-only role):** blast radius managed, but
  auditability and determinism lost; still the wrong habit to demo.
- **Semantic layer / text-to-SQL products:** overkill for one entity family.

## Consequences
Expressiveness is bounded by the spec — a feature: every possible query is
enumerable, testable, and safe. New capabilities are schema PRs.
