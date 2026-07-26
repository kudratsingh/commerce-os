# Domain Model — What Each Request Means in the Real World

The architecture docs explain how. This explains **why**: the physical and
financial story every request serves. Read this before the interview; you will
be explaining the system to merchants, not engineers.

## The cast

- **The shopper** — taps Buy during a livestream. Charged instantly by TikTok.
- **TikTok Shop (the marketplace)** — takes the money, owes the shopper a
  package, and holds Platinum accountable for shipping it (typically ~3
  business days, tracking uploaded) on pain of seller-metric penalties and
  listing suppression.
- **Platinum (seller of record, Buy & Sell mode)** — owns the inventory,
  owns the obligation, gets paid later on settlement cycles.
- **The warehouse (Van Nuys / 3PLs)** — where physical truth lives.
- **Ops staff** — account managers, purchasing, live producers. The users.
- **This system** — the system of record standing between all of them.

## The life of one unit

1. **PO placed** — money committed, nothing physical. Never touches inventory.
2. **Truck arrives, boxes counted** — the `receipt`. Ledger +qty, `on_hand`
   rises. (POs and receipts are separate because one PO can arrive as many
   trucks.) *This is the step Platinum does manually today.*
3. **Listed on a channel** — `channel_listings` translates the marketplace's
   SKU language into our product identity.
4. **Shopper buys on a livestream** — card charged, fulfillment countdown
   starts, and our system doesn't know yet.
5. **Webhook arrives** — TikTok POSTs to our registered URL. At-least-once
   delivery: duplicates are part of the contract, our 200 is the receipt that
   stops the resending.
6. **Allocation** — `committed` +qty. `available = on_hand - committed` drops
   everywhere at once, so no other channel can sell the same unit. This is
   the oversell defense: one unit, two marketplaces, two buyers in the same
   minute is a seller-fault cancellation strike; the CHECK constraint makes
   it structurally impossible.
7. **Shipment** — pick, pack, carrier. Ledger −qty; `on_hand` and `committed`
   fall together. (Production also pushes tracking back to the marketplace.)
8. **Later** — settlement payout; possibly a return (`return_received`
   movement adds stock back when goods physically arrive).

## Every request and its purpose

| Request | Real-world moment | Purpose |
|---|---|---|
| `receive_po_line` (RPC; seed today) | Truck at the dock | Turn "boxes counted" into ledger truth |
| Webhook `order.created` | Shopper paid during a stream | Reserve a unit before any other channel sells it; survive duplicate delivery |
| Webhook `order.cancelled` | Impulse buy reversed pre-shipment | Release the reservation within seconds so the unit is sellable again |
| Webhook duplicate | TikTok resent (we were slow/down) | Prove the contract: ack, change nothing |
| Webhook bad signature | Probe or rotated-secret misconfig | Refuse, but record — attacks should be observable |
| Webhook malformed | Poison message | Ack 200 (retry can't fix malformed), park in DLQ for a human |
| Webhook unknown SKU | AM listed a product on TikTok before the system knew it | Fail loudly with the missing mapping named; fix = add listing, Retry — no lost sales |
| Webhook cancel-before-create | Network reordered deliveries | Park, retry clean once the create lands |
| Dashboard load | Morning coffee / live show in progress | GMV, stock, stuck orders at a glance |
| Realtime feed | Live selling floor culture | Watch money move during streams; refresh-to-see would feel dead here |
| Ship action | Box physically leaves | The journal entry; physical truth changes now, not at order time |
| DLQ Retry | Human fixed the cause | Machine finishes the job; safe because every step is idempotent |
| Run reconciliation | Periodic audit | Do TikTok's beliefs match reality? Drift = overselling (strikes) or stranded stock (lost revenue). Also: rollup still equals journal |
| Resolve finding | Ops signed off | Close the loop on an investigated discrepancy |
| Skew report (chaos) | Simulated marketplace drift | Make the audit demoable on command |
| NL query | AM asks "how did Voltcore do yesterday" | Self-serve answers without SQL or an engineer |
| Simulator fire | — | Plays TikTok, duplicates and all, because real TikTok can't attend the interview |
| Outbox sweep (cron) | The follow-through | Every "and then notify/sync" guaranteed to happen even across crashes |

## Status glossary, warehouse edition

- `received` — TikTok told us; nothing reserved yet (transient, milliseconds).
- `allocated` — a unit is held for this order; pick/pack can proceed.
- `backordered` — sold without stock. A **business decision point**: expedite
  a PO, transfer, or cancel and eat the strike. The system's job is to make
  this loud, not to decide.
- `shipped` — physically gone; the ledger has its −qty.
- `cancelled` — reservation released; unit sellable again; marketplace
  handles the refund money.
- `refunded` — money returned post-shipment; goods may come back later as a
  `return_received` movement (schema supports it; demo UI does not).

PO side: `placed → partially_received → received` is simply "ordered" vs
"arrived, possibly across multiple trucks."

## Named but deliberately out of scope (say these, don't build them)

Tracking push-back to the marketplace, settlement/payout reconciliation,
returns UI and inspection flow, carrier label purchase, pick/pack (WMS
territory), multi-warehouse allocation choice, ad-spend (GMV Max) data.
Each is an adapter or module on top of this core; none changes the ledger,
the reservation model, or the ingestion contract — which is the argument
that this core is the right thing to build first.
