import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/domain/env";

import type { Database } from "./database.types";

/**
 * Supabase client for server code: route handlers, server components, cron
 * targets, tests. Uses the SERVICE ROLE key — bypasses RLS, treat as admin.
 * Never import from anything reachable by the client bundle.
 */
export function createSupabaseServer(): SupabaseClient<Database> {
  const env = serverEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" },
      global: { headers: { "x-application": "commerce-os" } },
    },
  );
}

export type Db = SupabaseClient<Database>;
