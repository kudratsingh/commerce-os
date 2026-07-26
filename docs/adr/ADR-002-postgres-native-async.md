# ADR-002: Postgres-native async (outbox + cron), not Kafka

**Status:** Accepted · **Date:** Day 0

## Context
Side effects (notifications, downstream syncs) must survive crashes: nothing
lost between a domain commit and its side effect. The author's reference
implementation (incident platform) uses a transactional outbox relayed into
Kafka with eight consumer groups. This system has one engineer, runs on
Workers isolates, and moves thousands — not millions — of events per day.

## Decision
Keep the outbox guarantee, drop the broker: an `outbox` table written in the
same transaction as domain changes, swept by a Workers Cron Trigger (1/min) that
delivers with exponential backoff (`next_attempt_at`) and DLQs after max
attempts. Sweep is re-entrant and safe to double-fire.

## Alternatives rejected
- **Kafka/Redpanda:** consumer groups and replay are unneeded at this fanout;
  the operational cost lands on the one engineer. Right answer at 100x.
- **SQS/SNS:** adds an AWS surface to a Cloudflare+Supabase shop for no guarantee
  we don't already get from Postgres.
- **Cloudflare Queues:** the natural on-platform graduation — native batching
  and dead-letter queues. Deferred only to keep the demo's moving parts
  explainable in one diagram; it is the named next step.

## Revisit when
Sustained >~50 events/sec, a second consumer needs independent replay, or a
service boundary splits ingestion from the app. First move: relay the outbox
into Cloudflare Queues consumers (same commit-then-relay guarantee, managed
delivery). Kafka stays the 100x conversation — the incident platform's relay
pattern is a known road.
