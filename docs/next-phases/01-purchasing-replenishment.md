# Module 1 — Purchasing & Replenishment Intelligence

**Serves:** Purchasing lead, account managers · **Builds on:** `stock_movements`, `stock_levels`, `orders`, `purchase_orders`, `receipts` from the ledger core.

**One-liner from `ROADMAP.md`:** turn the ledger's sell-through velocity per SKU per channel into buying decisions, kill the manual receiving ledger, expose true P&L per SKU per channel.

---

## Success metrics

The module lands when:

1. Purchasing lead uses `/purchasing` daily instead of a spreadsheet to place, receive, and close POs.
2. Every SKU has a **reorder-point alert** rule live in the system and firing when velocity + lead time say "order now."
3. Every SKU has a **true landed cost** and a **margin per channel** (marketplace fees deducted) — no more "gross margin" fiction.
4. **Aged inventory** view shows capital tied up in SKUs that stopped moving, sorted by dollars-at-risk.

Adoption threshold: purchasing lead approves week-of-launch that manual PO log stops updating.

---

## Schema additions

Additive migration (no edits to existing tables). New tables:

### `suppliers`
Buy-side counterparties. `purchase_orders.supplier` is currently a free-text string; this normalizes it.

```sql
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_email text,
  contact_phone text,
  currency      char(3) not null default 'USD',
  notes         text,
  created_at    timestamptz not null default now()
);
```

Migration also alters `purchase_orders` to add `supplier_id uuid references suppliers(id)` (nullable), with a small data migration that inserts one supplier row per distinct `purchase_orders.supplier` value and backfills.

### `supplier_products`
Per-supplier catalog: what a supplier sells us, at what unit cost, with what lead time. One product can have multiple suppliers (primary + alt).

```sql
create table supplier_products (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null references suppliers(id),
  product_id            uuid not null references products(id),
  supplier_sku          text,
  unit_cost_cents       integer not null check (unit_cost_cents >= 0),
  moq                   integer not null default 1 check (moq > 0),      -- minimum order qty
  lead_time_days        integer not null check (lead_time_days >= 0),
  is_primary            boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create unique index one_primary_per_product
  on supplier_products (product_id) where is_primary;
```

### `reorder_points`
Per-product-per-location threshold + policy. Not per-supplier — the reorder is about "should we buy?" not "who from?".

```sql
create table reorder_points (
  product_id       uuid not null references products(id),
  location_id      uuid not null references locations(id),
  min_qty          integer not null check (min_qty >= 0),
  target_qty       integer not null check (target_qty >= min_qty),
  velocity_window  interval not null default interval '30 days',
  auto_generated   boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (product_id, location_id)
);
```

### `fee_schedules`
Per-channel-per-product fee model. `orders.subtotal_cents` is gross; net revenue after marketplace fees is `subtotal_cents - (fee_pct * subtotal_cents / 10000) - fee_flat_cents`. Simple linear model; Module 5 (Settlement Recon) refines with per-line lookups against actual payout files.

```sql
create table fee_schedules (
  id                 uuid primary key default gen_random_uuid(),
  channel_id         text not null references channels(id),
  product_id         uuid references products(id),           -- null = channel default
  brand_id           uuid references brands(id),             -- null = all brands
  category           text,                                    -- optional facet
  fee_pct_bps        integer not null check (fee_pct_bps >= 0),   -- basis points, 250 = 2.5%
  fee_flat_cents     integer not null default 0 check (fee_flat_cents >= 0),
  effective_from     timestamptz not null default now(),
  effective_until    timestamptz,
  created_at         timestamptz not null default now()
);

-- Latest-effective wins; unique per (channel, product, brand, category)
create index fee_schedules_lookup on fee_schedules
  (channel_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
   effective_from desc);
```

### `landed_costs`
Denormalized snapshot of what a unit COST US (supplier unit cost + duties + freight + inbound handling). Written when a receipt lands; enables true margin without re-computing.

```sql
create table landed_costs (
  id                    uuid primary key default gen_random_uuid(),
  receipt_id            uuid not null references receipts(id),
  product_id            uuid not null references products(id),
  qty                   integer not null check (qty > 0),
  unit_cost_cents       integer not null check (unit_cost_cents >= 0),
  duties_cents          integer not null default 0 check (duties_cents >= 0),
  freight_cents         integer not null default 0 check (freight_cents >= 0),
  handling_cents        integer not null default 0 check (handling_cents >= 0),
  landed_unit_cents     integer generated always as
    (unit_cost_cents + duties_cents + freight_cents + handling_cents) stored,
  received_at           timestamptz not null default now()
);
```

### RLS
All new tables get `brand_id` via join or direct column. `suppliers` is shared across brands (a supplier serves multiple), so RLS is `service_role`-only for the ops dashboard; brand-scoped views expose only the brand's own supplier relationships (via `supplier_products` → `products` → `brand_id`).

---

## Domain functions

**`receive_shipment(po_line_id, location_id, qty, unit_cost_cents, duties, freight, handling, received_by)`** — supersedes the current `receive_po_line`. Same append-only ledger discipline, adds landed-cost snapshot.

```plpgsql
-- pseudocode
begin
  -- existing receive_po_line logic: writes stock_movements, updates stock_levels
  perform receive_po_line(...);

  -- new: capture landed cost per receipt
  insert into landed_costs (receipt_id, product_id, qty, unit_cost_cents, ...)
  values (v_receipt_id, v_product_id, p_qty, p_unit_cost_cents, ...);

  -- new: if PO is now fully received, transition status
  if (select sum(qty_received) from receipts where po_line_id = p_po_line_id) >=
     (select qty_ordered from purchase_order_lines where id = p_po_line_id) then
    update purchase_orders set status = ... where id = ...;
  end if;

  return v_receipt_id;
end;
```

**`compute_reorder_signals(location_id, brand_id?)`** — reads `stock_levels`, `orders` history, `reorder_points`, `supplier_products.lead_time_days`. Returns a table of `(product_id, current_available, velocity_per_day, days_of_cover, recommended_qty, primary_supplier_id, urgency)`. Called by the alerts page + a cron for background scoring.

**`compute_margin_snapshot(order_id)`** — takes an order at ship time, looks up `landed_costs` for the units shipped (FIFO by `received_at`), applies the appropriate `fee_schedules` row, writes a `margin_snapshots` row. Materializes true margin at the moment of truth so backdated fee changes don't lie about history.

### `margin_snapshots` (also new)

```sql
create table margin_snapshots (
  order_id                uuid not null references orders(id),
  order_line_id           uuid not null references order_lines(id),
  gross_revenue_cents     bigint not null,
  fee_cents               bigint not null,
  landed_cost_cents       bigint not null,
  net_margin_cents        bigint generated always as
    (gross_revenue_cents - fee_cents - landed_cost_cents) stored,
  computed_at             timestamptz not null default now(),
  primary key (order_line_id)
);
```

Trigger on `ship_order` (or an outbox handler for it) computes the snapshot. Never touched after that — history is immutable.

---

## Read layer (views)

- **`purchase_orders_dashboard`** — POs with supplier name, brand name, lines received / lines ordered, days-outstanding.
- **`replenishment_alerts`** — `compute_reorder_signals` as a view sorted by urgency descending.
- **`sku_margin_by_channel`** — average `net_margin_cents` per SKU per channel over the last 30/60/90 days.
- **`aged_inventory`** — SKUs where `on_hand > 0` and `days_since_last_shipment > 60`, sorted by `landed_cost_cents * on_hand` descending (dollars-at-risk).
- **`landed_cost_history`** — receipts joined to landed cost, for the SKU detail page.

---

## Routes + pages

### `/purchasing`
Server-rendered list of POs from `purchase_orders_dashboard`. Filters: status, brand, supplier. Header actions: **New PO**.

### `/purchasing/[po_id]`
PO detail: header (supplier, expected date, status, total cost), lines table (product, qty ordered, qty received, unit cost). Per-line action: **Receive** (opens modal → calls `receive_shipment` RPC with qty + landed-cost breakdown).

### `/purchasing/new`
Create-PO form. Multi-line entry: pick brand → filter products → pick supplier → set qty + unit cost. Submits a server action that creates the PO and lines.

### `/replenishment`
Sorted table of replenishment alerts from `replenishment_alerts`. Per-row action: **Draft PO** (pre-fills a `/purchasing/new` form with recommended qty from the primary supplier). Cards at the top: alerts today, dollars-at-risk, longest lead time.

### `/margin`
Sortable table of `sku_margin_by_channel`. Filter by brand/channel/window. Highlights: negative-margin SKUs in red, thin-margin (<5%) in amber. Per-row expand: `landed_cost_history` chart.

### `/inventory/aged`
`aged_inventory` sorted by dollars-at-risk. Per-row action: **Mark for markdown** (writes a `stock_flag` — small tag table to be defined here).

### API routes
- `POST /api/purchase-orders` — create PO (used by the /purchasing/new form's server action).
- `POST /api/purchase-orders/[id]/receive` — receive a shipment (per line).
- `POST /api/purchase-orders/[id]/close` — force-close a PO.
- `POST /api/reorder-points` — upsert per-product-per-location thresholds.

All routes session-gated via the ops-auth prerequisite listed in `README.md`.

---

## Components

Under `components/purchasing/`:

- `POTable.tsx` (server) — the list.
- `POLineRow.tsx` (server) with client `ReceiveButton.tsx`.
- `ReceiveModal.tsx` (client) — qty + landed cost breakdown.
- `NewPOForm.tsx` (client) — multi-line PO entry.

Under `components/replenishment/`:

- `AlertsTable.tsx` (server) with `DraftPOAction.tsx` (client).
- `AlertCards.tsx` — top-of-page summary.

Under `components/margin/`:

- `SKUMarginTable.tsx` (server).
- `LandedCostChart.tsx` (client — Recharts).

Nav: Header gains a **Purchasing** dropdown (`POs`, `Receive`, `Replenishment`, `Margin`, `Aged inventory`).

---

## PR breakdown

Sized so each PR leaves `main` green + demoable, ~300-800 LOC each.

### PR M1-A: schema + read layer (~600 LOC)
- Migration 006: `suppliers`, `supplier_products`, `reorder_points`, `fee_schedules`, `landed_costs`, `margin_snapshots` + all RLS grants + views (`purchase_orders_dashboard`, `sku_margin_by_channel`, `aged_inventory`, `landed_cost_history`).
- `lib/queries/purchasing.ts`, `lib/queries/margin.ts` — typed reads.
- Backfill: script that migrates existing `purchase_orders.supplier` free-text → `suppliers` rows + `supplier_id`.
- Regenerate `lib/db/database.types.ts`.
- Integration tests: view shapes.

### PR M1-B: PO lifecycle UI (~700 LOC)
- Migration 007: `receive_shipment` RPC + `close_purchase_order` RPC.
- `/purchasing` list page, `/purchasing/[po_id]` detail, `/purchasing/new` create.
- `POST /api/purchase-orders`, `POST /api/purchase-orders/[id]/receive`, `POST /api/purchase-orders/[id]/close`.
- Session-gated (also brings in ops-auth if not already merged).
- Integration tests: create PO → partial receive → full receive → status transitions.

### PR M1-C: replenishment engine (~500 LOC)
- Migration 008: `compute_reorder_signals` RPC + `replenishment_alerts` view.
- `/replenishment` page.
- `POST /api/reorder-points` for upsert.
- Cron: nightly RPC call that materializes a per-SKU velocity snapshot into `replenishment_snapshots` (new table, cheap trend line).
- Integration: seed 30 days of orders → assert alert fires on a SKU with `velocity * lead_time > available`.

### PR M1-D: margin + fees + aged inventory (~600 LOC)
- Migration 009: `compute_margin_snapshot` RPC + trigger on `ship_order` OR outbox consumer.
- `/margin` page + `sku_margin_by_channel` UI.
- `/inventory/aged` page.
- Fee schedule editor (small — sits under `/settings/fees`).
- Integration: ship an order → margin snapshot written with correct fee applied.

### PR M1-E: polish + telemetry (~300-500 LOC)
- Real seed of ~5 suppliers, per-product supplier links, reorder points for the seeded 12 products.
- Demo script update: purchasing walkthrough.
- Header nav update.
- ADR-009: additive landed-cost model (why FIFO by receipt time, not weighted average).

Total: ~2,700-3,000 LOC across 5 PRs. First PR merges within a week if a single engineer works this alone; whole module lands in 3-4 weeks of a focused sprint.

---

## Testing

Beyond the standard 6 SQL invariants (which continue to gate CI):

- **Receipts trigger landed-cost snapshots** — SQL test that a receipt without a matching landed_costs row is a bug.
- **`compute_reorder_signals` never recommends below MOQ** — supplier constraint respected.
- **Margin snapshot uses receipt-time landed cost, not current** — regression against "fee change retroactively rewrites margin history."
- **Aged inventory dollar-at-risk = `landed_unit_cents * on_hand`** — arithmetic gate.

Integration coverage per PR listed above.

---

## Deliberate deferrals

- **Multi-currency POs.** Suppliers can be non-USD (currency column on `suppliers`), but FX-adjustment logic is Module 5 territory (settlement reconciliation).
- **Consignment inventory.** Not owned by Platinum → doesn't touch `stock_movements` → not this module.
- **Purchase forecasting (statistical).** Reorder-point uses trailing-30-day velocity; time-series forecasting (Holt-Winters, Prophet) is a Module 4-adjacent metrics-spine extension, not this.
- **PO approval workflow (multi-signature).** Everything here is single-user-authored. Approval flow is a Module 3-family concern (roles beyond ops).

---

## Open questions

1. **FIFO landed cost, or weighted-average per SKU?** ADR-009 (drafted in PR M1-E) picks one. FIFO is more auditable; weighted-average is easier to explain and matches most POS reports. Recommendation: FIFO, because the ledger IS FIFO by design.
2. **Where does a shipping-in freight bill land if it covers multiple POs?** Split proportionally by unit cost? Split by qty? By cube? Recommendation: proportional to line-total dollars, with an override field.
3. **Do we need a supplier "score"?** Lead-time reliability, on-time rate, defect rate. Could be a `supplier_snapshots` monthly view. Deferred to Module 5-adjacent work, but worth flagging.

---

## Landed

_This section fills in with merged PR numbers as they land._
