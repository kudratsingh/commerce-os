# Module 5 — Settlement Reconciliation

**Serves:** finance / ownership · **Builds on:** `orders`, `order_lines`, the reconciliation pattern from PRs #1 + #3, Module 1's `fee_schedules` + `landed_costs` (for expected-net computation).

**One-liner from `ROADMAP.md`:** the exact trust-but-verify pattern already running against inventory, pointed at money. At ~$100M GMV, finding 0.5% of leakage pays for the engineering team.

---

## Success metrics

The module lands when:

1. Every marketplace payout file lands in the system within an hour of arrival.
2. **Every dollar of expected revenue** (per order, per line) is compared to the payout, and every mismatch surfaces as a `settlement_finding`.
3. **Recovery workflow**: findings can be marked `disputed → filed → recovered` with amounts and channel case IDs.
4. Finance stops running the "monthly leakage audit" spreadsheet.

Adoption threshold: 0.3-0.5% of GMV consistently identified as leakage per month, matching the roadmap's promise.

---

## The pattern reused

The demo's inventory reconciliation (PRs #1 + #3) is: rollup vs journal (internal drift), channel report vs available-to-sell (external drift). Module 5 is the same pattern applied to money:

- **Internal expected**: `orders.subtotal_cents - expected_fees(fee_schedules) - landed_cost` per order line.
- **External actual**: marketplace payout file per order line.
- **Findings**: any mismatch > tolerance (usually rounding cents), categorized (fee miscalc, missed refund clawback, unpaid order, chargeback, adjustment).

The `run_reconciliation()` function template already exists. Module 5 adds a payout-specific version.

---

## Schema additions

### `payout_files`
One row per file ingested (usually CSV or a marketplace API pull).

```sql
create table payout_files (
  id                 uuid primary key default gen_random_uuid(),
  channel_id         text not null references channels(id),
  merchant_id        text,                              -- their shop id
  filename           text,
  period_start       timestamptz not null,
  period_end         timestamptz not null,
  total_amount_cents bigint not null,
  fees_amount_cents  bigint not null,
  net_amount_cents   bigint not null,
  raw_source         jsonb,                             -- API response or CSV metadata
  ingested_at        timestamptz not null default now(),
  ingested_by        text,
  unique (channel_id, merchant_id, period_start, period_end)
);
```

### `payout_lines`
Individual money movements from the file. One row per transaction.

```sql
create table payout_lines (
  id                    bigint generated always as identity primary key,
  payout_file_id        uuid not null references payout_files(id),
  channel_id            text not null references channels(id),
  external_order_id     text,                          -- matches orders.external_order_id
  external_line_id      text,                          -- their id for the line item
  kind                  text not null check (kind in
                          ('order','refund','chargeback','adjustment','fee','tax','promo','shipping')),
  gross_cents           bigint not null,               -- signed
  fee_cents             bigint not null default 0,
  tax_cents             bigint not null default 0,
  net_cents             bigint not null,               -- signed
  currency              char(3) not null default 'USD',
  posted_at             timestamptz not null,
  matched_order_line_id uuid references order_lines(id),
  matched_at            timestamptz
);

create index payout_lines_ext on payout_lines (channel_id, external_order_id);
create index payout_lines_unmatched on payout_lines (channel_id)
  where matched_order_line_id is null;
```

### `settlement_findings`
The trust-but-verify output. Parallel structure to `reconciliation_findings` from PR #1.

```sql
create table settlement_findings (
  id             bigint generated always as identity primary key,
  run_id         uuid not null,
  kind           text not null check (kind in
                   ('fee_mismatch','missing_payout','extra_payout','refund_clawback_missed',
                    'shipping_underpaid','tax_mismatch','currency_variance','other')),
  channel_id     text not null references channels(id),
  brand_id       uuid references brands(id),
  order_line_id  uuid references order_lines(id),
  payout_line_id bigint references payout_lines(id),
  expected_cents bigint not null,
  actual_cents   bigint not null,
  delta_cents    bigint not null generated always as (actual_cents - expected_cents) stored,
  status         text not null default 'open'
                 check (status in ('open','disputed','filed','recovered','abandoned','wontfix')),
  case_id        text,                                 -- their support case reference
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index findings_open on settlement_findings (status) where status in ('open','disputed','filed');
```

### `settlement_runs`
Mirrors `reconciliation_runs` from PR #1.

```sql
create table settlement_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  window_start   date not null,
  window_end     date not null,
  findings_count integer,
  total_delta_cents bigint
);
```

---

## Domain functions

**`ingest_payout_file(channel_id, file_url, uploaded_by)`** — pulls a file (or receives it inline), parses per-channel format, inserts `payout_files` + `payout_lines`. Uses `ON CONFLICT (channel_id, external_line_id) DO NOTHING` so the same line delivered twice doesn't duplicate. Handled per-channel by a translation layer parallel to the marketplace adapter pattern (Module 6).

**`match_payouts(channel_id, window_start, window_end)`** — updates `payout_lines.matched_order_line_id` by joining on `external_order_id`. Also detects `payout_lines` with no matching order (a "phantom payout" — often a manual adjustment we don't have a record of).

**`run_settlement(channel_id, window_start, window_end)`** — the reconciliation pass:

1. Insert `settlement_runs` row.
2. For every `payout_lines` in the window, compute expected: from `orders.subtotal_cents` × `fee_schedules` for the channel + brand.
3. If actual (from payout) ≠ expected (from our books) by > tolerance, insert `settlement_findings`.
4. For every `order_lines` in the window WITHOUT a matching payout, insert a `missing_payout` finding.
5. Update `settlement_runs.findings_count` + `total_delta_cents`.
6. Return the run id.

Same structural pattern as `run_reconciliation()` (inventory). Different signals, same shape.

**`resolve_settlement_finding(finding_id, status, case_id?, notes?, recovered_cents?)`** — transitions a finding through the workflow (`open → disputed → filed → recovered` or `open → wontfix`). Audit trail preserved.

---

## Read layer

- **`open_settlement_findings`** — all findings not yet resolved, with joined product/order/brand context.
- **`recovery_summary_by_month`** — total recovered $ per month, per channel, per brand.
- **`unmatched_payouts`** — `payout_lines.matched_order_line_id IS NULL` (the "phantom" ones needing manual attention).
- **`missing_payouts`** — `order_lines` shipped in a window with no matching `payout_lines`.

---

## Routes + pages

### `/finance`
Finance home. Cards: total open $ at risk, recovered this month, longest-open finding age. Recent settlement runs table.

### `/finance/findings`
Filterable open findings. Per-row: expected, actual, delta, kind. Actions: **Mark disputed**, **File** (opens a form for case id + notes), **Mark recovered** (opens amount form), **Won't fix** (with required reason).

### `/finance/uploads`
CSV upload interface. Per-channel format selection. After upload: preview + import.

### `/finance/runs`
Run history + per-run findings drill-down.

### API routes
- `POST /api/finance/payouts/upload` — CSV upload.
- `POST /api/finance/settlement/run` — kicks off `run_settlement`.
- `POST /api/finance/findings/[id]/resolve` — transition.
- `POST /api/adapters/[channel]/payout-sync` — cron target for API-based pulls.

---

## PR breakdown

Total: ~2,500-3,200 LOC across 4 PRs.

### PR M5-A: schema + payout ingest (~800 LOC)
- Migration 018: `payout_files`, `payout_lines`, `settlement_findings`, `settlement_runs`, indexes.
- `lib/queries/settlement.ts`.
- `ingest_payout_file` + per-channel CSV parsers under `lib/adapters/[channel]/payouts.ts`.
- `/finance/uploads` with drag-drop CSV ingest.
- Test: TikTok sample CSV → correct `payout_lines` rows; duplicate upload → no dupe.

### PR M5-B: matching + reconciliation (~700 LOC)
- Migration 019: `match_payouts`, `run_settlement` RPCs, `open_settlement_findings` + `unmatched_payouts` + `missing_payouts` views.
- `/finance/findings` list with filters.
- `POST /api/finance/settlement/run` route.
- Test: seed orders → seed payout file with a fee mismatch → run → assert one finding with correct delta.

### PR M5-C: recovery workflow UI (~600 LOC)
- `resolve_settlement_finding` RPC with status transitions.
- Per-row action modals on `/finance/findings`.
- `/finance/runs` history + drill-down.
- `recovery_summary_by_month` view + widget on `/finance`.

### PR M5-D: API-based sync + monthly cron (~500 LOC)
- `/api/adapters/tiktok/payout-sync` (once TikTok's payout API is exposed via Module 6.a's OAuth).
- Cron: monthly settlement run per channel + brand.
- Ops runbook doc.

---

## Testing

- **Matching correctness**: seed 10 orders + 10 payout lines with same external_order_ids → all matched. Seed one payout line with an unknown external_order_id → `unmatched_payouts` shows it.
- **Fee mismatch detection**: order subtotal $100, fee schedule 5%, payout fee $6 → finding with delta $1 (100 cents), kind `fee_mismatch`.
- **Missing payout**: ship an order → no payout arrives → next `run_settlement` creates a `missing_payout` finding.
- **Refund clawback**: seed a refund payout line → check that a previously-recorded revenue line is flagged for reversal.
- **Idempotent upload**: same CSV uploaded twice → no duplicate `payout_lines` (unique constraint on `(channel_id, external_line_id)`).

---

## Deliberate deferrals

- **FX-adjusted payouts** for non-USD channels. Complex — needs an FX rate table + policy. Q4+.
- **Automatic dispute filing** through marketplace APIs. Sometimes possible (Amazon), often not (TikTok). Semi-automated form-fill instead.
- **Multi-currency payment tolerances**. Punt with the FX question.
- **Cash flow forecast** from expected-payout timing. Interesting but Module 1-adjacent.

---

## Open questions

1. **Tolerance for finding creation.** Rounding cents happen. Recommendation: > $0.05 or > 0.1% of order value, whichever larger. Configurable per channel via a `settlement_tolerances` table (not defined here — add to M5-B if the initial run produces too much noise).
2. **What's the reconciliation window?** Weekly for TikTok (their payout cadence), monthly for others. Store per-channel in `channel_settings` (new small table added by whichever module needs it first).
3. **Recovery attribution to team**: who filed which finding, who recovered? Add `filed_by` + `recovered_by` columns to `settlement_findings`.
4. **How does a resolved finding become an accounting entry?** Point at QuickBooks / Xero export — vendor call, punt to a later "finance exports" PR.

---

## Landed

_This section fills in with merged PR numbers as they land._
