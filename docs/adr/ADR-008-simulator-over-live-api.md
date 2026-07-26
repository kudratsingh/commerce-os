# ADR-008: A signing marketplace simulator instead of live TikTok Shop API

**Status:** Accepted · **Date:** Day 0

## Context
Real TikTok Shop API access requires approved partner credentials —
weeks of lead time, not five days. Separately, a live demo needs
deterministic, repeatable failure injection; production APIs don't fail on
command.

## Decision
An in-app simulator fires webhooks at the system's own public endpoint,
signed with the same HMAC scheme the verifier checks, speaking a contract
shaped like real marketplace order webhooks. Chaos buttons: duplicate
delivery, burst 50, malformed payload, bad signature, out-of-order cancel,
and channel-report skew (to exercise reconciliation).

## Why this is a feature, not a workaround
- Exercises the REAL ingestion path over real HTTP — no mocked shortcuts.
- Turns invisible hardening (idempotency, DLQ, firewalls) into visible demo.
- Becomes the permanent integration-test harness: chaos scenarios are the
  regression suite for the day a real marketplace adapter lands.

## Consequences
The real TikTok Shop adapter later is a translation layer (their payload +
signature scheme → our contract) — an adapter PR, not a redesign. Say the
access constraint out loud in the demo; honesty about it reads as judgment.
