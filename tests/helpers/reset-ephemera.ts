import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

/**
 * Reset every integration test file to a known baseline.
 *
 * Ephemeral tables (outbox, orders, ledger, findings, reports, receipts…)
 * are truncated; `stock_levels` is restored from `_test_baseline_stock`,
 * which was snapshotted from the seed at migration time (migration 014).
 *
 * Called from each integration test file's `beforeAll`. The alternative —
 * running `supabase db reset --local` between files — is 10–15s per file,
 * so the whole suite would take 2+ minutes just for setup. The RPC path
 * is ~100ms and leaves the catalog + baseline intact.
 *
 * Safe to call unconditionally: the fresh baseline is deterministic and
 * the function is a no-op if the env vars for local Supabase aren't set
 * (running in a CI variant that doesn't spin up Postgres).
 */

let cached: SupabaseClient<Database> | null = null;

function client(): SupabaseClient<Database> | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!cached) {
    cached = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
  }
  return cached;
}

/**
 * Retry a few times if TRUNCATE hits a residual lock from a PostgREST
 * connection that hasn't returned to the pool yet. Second attempt almost
 * always succeeds; if all three fail it's a real problem worth surfacing.
 */
export async function resetEphemera(): Promise<void> {
  const db = client();
  if (!db) return;

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await db.rpc("reset_test_state");
    if (!error) return;
    lastError = error.message;
    if (!/lock_timeout|deadlock|canceling statement|schema cache/i.test(lastError)) {
      throw new Error(`resetEphemera failed: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error(`resetEphemera failed after retries: ${lastError}`);
}
