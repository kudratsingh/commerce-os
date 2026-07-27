# commerce-os-cron

A tiny separate Cloudflare Worker whose only job is to POST `/api/jobs/outbox-sweep` on the main Commerce OS worker every minute (Cloudflare Cron Trigger).

## Why a separate Worker

The main worker is Next.js built by OpenNext — its entrypoint (`.open-next/worker.js`) is generated, and injecting a custom `scheduled()` handler would require wrapping the generated bundle in a post-build step. Keeping the cron in its own tiny Worker is cheaper operationally: the main worker's deploy pipeline stays clean, this Worker is ~50 lines and independently reviewable, and the two are decoupled at the HTTPS boundary using the same `x-cron-secret` guard the main worker already enforces.

## Deploy

Prereq: `wrangler login` under the same Cloudflare account that owns the main worker.

```bash
cd cron-worker
pnpm install

# Point at the main worker's sweeper URL
wrangler secret put OUTBOX_SWEEP_URL
# → https://commerce-os.singhkudrat59.workers.dev/api/jobs/outbox-sweep

# Must match the main worker's WEBHOOK_SHARED_SECRET
wrangler secret put CRON_SECRET

wrangler deploy
```

## Verify

```bash
# Manual trigger — hits the sweeper once and returns upstream response
curl https://commerce-os-cron.<your-subdomain>.workers.dev/

# Watch cron firings
pnpm tail
```

## Behavior

- **Scheduled (`* * * * *`)**: every minute, fire and forget via `ctx.waitUntil(sweep(env))`.
- **Fetch (GET or POST)**: same sweep, but returns the upstream response so you can see what the main worker delivered.
- If `OUTBOX_SWEEP_URL` or `CRON_SECRET` is unset, returns 503 with a clear error — no silent failure.
- The main worker's sweep RPC uses `FOR UPDATE SKIP LOCKED`, so overlapping firings never double-deliver.
