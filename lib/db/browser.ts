"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Supabase client for the browser. Anon key only — RLS applies.
 * Used by client components for Realtime subscriptions (Day 3 dashboard).
 * See ADR-005 for why the Worker is not in the Realtime path.
 */
export function createSupabaseBrowser(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set at build time",
    );
  }
  return createClient<Database>(url, key);
}
