# ADR-010: Ports & adapters for marketplace transports

**Status:** Accepted · **Date:** Post-Module-1

## Context

ADR-008 chose a simulator over live marketplace APIs for **inbound** ingestion: partner credentials take weeks to obtain, and even with them, live APIs don't fail on command — a signing marketplace simulator was the right answer for a five-day proof-of-concept.

The **outbound** side of the same wire — pushing our `available_to_sell` back to TikTok Shop, acknowledging orders, updating tracking — has the same access problem and the same demo problem: without a real credential, there's no destination to write to; without a way to make the destination misbehave, retry semantics are a README claim rather than something you can prove on stage.

The naïve upgrade from "no outbound" would be a stub: `MarketplaceAdapter.updateInventory()` returns `{ok: true}` and does nothing. That proves our code can call a function and parse a 200. It doesn't prove the loop — inject fault, detect drift, dispatch correction, verify corrected — actually works.

## Decision

Adopt **Ports & Adapters** (hexagonal architecture) for every marketplace transport we build, starting with TikTok Shop:

1. **The port is a first-class TypeScript interface.** `MarketplaceAdapter` declares the outbound operations (`updateInventory`, later `acknowledgeOrder`, `pushListing`, `pushTracking`). Domain code depends on the interface; concrete implementations plug in behind a small registry keyed by `channel_id`.

2. **The first implementation is a stateful fake, not a stub.** `SimulatedTikTokAdapter.updateInventory` writes a fresh row to `channel_inventory_reports` — the same table our reconciliation query already reads to know "what the marketplace believes." The fake is a real, working marketplace-brain; the only thing simulated is the wire. When we skew the fake it believes a wrong number; when we correct it, the next reconciliation run sees zero drift.

3. **The fake is hostile where it teaches.** A `simulator_config.hostile_rate` value drives a percentage of `updateInventory` calls to return a retryable failure (429-shape). The outbox sweeper's existing `outbox_mark_failed` + exponential backoff is now demonstrable live: fire a burst under 30% hostility, watch a subset of rows retry, verify eventual convergence.

4. **The full self-healing loop closes on stage:**
   - Skew: the fake believes wrong.
   - `run_reconciliation` writes a `channel_drift` finding AND an `inventory.sync` outbox row per finding.
   - Sweeper claims the row, dispatches via the adapter, which writes the correct qty back to `channel_inventory_reports`.
   - The next reconciliation run sees no drift, and old open findings auto-resolve because the delta has closed.
   - Inject fault → detect → auto-correct → prove corrected. Ninety seconds, one loop.

## Alternatives rejected

- **Canned-response stub.** Proves parsing, not the loop. Rejected because the interesting invariants (retry, backoff, DLQ escalation, convergence) all live inside the loop.
- **Live TikTok Shop against a sandbox account.** Same credential lead time as ADR-008. Also: sandboxes don't fail on demand.
- **Adapter code inlined in the outbox sweep route.** Works for one channel; every subsequent channel means editing the sweep route. The port makes each new channel one PR against interfaces that already exist (the ROADMAP Module 6 promise, in code).

## Consequences

- **Real regression harness for the day credentials arrive.** The interface stays; only the adapter implementation is swapped. The chaos suite that exercised the fake becomes the chaos suite that exercises the real adapter — same skew scenarios, same hostile percentages, same convergence assertions.
- **Interview-shape argument.** "The adapter interface and the retry machinery are real; only the transport is simulated. The day credentials arrive, I write one real adapter against the same interface, and the chaos suite becomes its regression harness." This is [Module 6.a](../next-phases/02-tiktok-shop-adapter.md) in code, not in a doc.
- **Outbox handler grows a small dispatcher.** Adds an event-type → adapter routing layer, but the dispatcher is small enough to be walked at a whiteboard in one minute (`inventory.sync` → `getAdapter(channel_id).updateInventory(payload)`).

## Related

- [ADR-008](./ADR-008-simulator-over-live-api.md) — the inbound decision this extends.
- [ROADMAP Module 6.a](../next-phases/02-tiktok-shop-adapter.md) — the real TikTok Shop adapter that swaps `SimulatedTikTokAdapter` for a live implementation without touching a domain function.
