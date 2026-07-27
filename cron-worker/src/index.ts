/**
 * commerce-os-cron — the sweeper trigger.
 *
 * Every minute, POST /api/jobs/outbox-sweep on the main worker with the
 * shared cron secret. Also exposes GET / as a manual trigger for demos and
 * dry-runs (returns whatever the main worker returned).
 *
 * The main worker's /api/jobs/outbox-sweep already claims rows atomically
 * (FOR UPDATE SKIP LOCKED — see supabase/migrations/003_process_order_event
 * for the RPC), so overlapping firings never double-deliver.
 */

export interface Env {
  OUTBOX_SWEEP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const result = await sweep(env);
    return Response.json(result, { status: result.upstream_status });
  },
};

async function sweep(env: Env): Promise<{
  upstream_status: number;
  upstream_body: unknown;
  target: string;
}> {
  if (!env.OUTBOX_SWEEP_URL) {
    return {
      upstream_status: 503,
      upstream_body: { error: "OUTBOX_SWEEP_URL not configured — `wrangler secret put OUTBOX_SWEEP_URL`" },
      target: "(unset)",
    };
  }
  if (!env.CRON_SECRET) {
    return {
      upstream_status: 503,
      upstream_body: { error: "CRON_SECRET not configured — `wrangler secret put CRON_SECRET`" },
      target: env.OUTBOX_SWEEP_URL,
    };
  }

  const started = Date.now();
  const res = await fetch(env.OUTBOX_SWEEP_URL, {
    method: "POST",
    headers: { "x-cron-secret": env.CRON_SECRET },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  console.log(
    `sweep → ${res.status} in ${Date.now() - started}ms`,
    typeof body === "object" ? JSON.stringify(body) : body,
  );

  return {
    upstream_status: res.status === 200 ? 200 : res.status,
    upstream_body: body,
    target: env.OUTBOX_SWEEP_URL,
  };
}
