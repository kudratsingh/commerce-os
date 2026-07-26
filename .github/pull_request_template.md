## Summary
<!-- What and why, two sentences. Link the BUILD_PLAN day or issue. -->

## Invariants touched
<!-- Check all that apply and say how the guarantee is still protected. -->
- [ ] Ledger (`stock_movements`) — append-only preserved because:
- [ ] Rollup (`stock_levels`) — mutated only via domain functions because:
- [ ] Idempotency (webhook/order dedupe) — still holds because:
- [ ] Money/quantity handling — integer cents/units only because:
- [ ] None of the above

## Test evidence
<!-- Paste the relevant PASS lines: pnpm test + db/tests/invariants.sql -->
```
```

## ADR
- [ ] No decision changed
- [ ] ADR added/superseded: <!-- link -->

## Screenshots
<!-- UI changes only -->
