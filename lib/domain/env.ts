import "server-only";

import { z } from "zod";

/**
 * Server-side environment. Read once, validated once, cached.
 * Imported into server components, route handlers, and cron targets — never
 * the client bundle. `server-only` above turns any client import into a
 * build error (invariant #8 in CLAUDE.md).
 *
 * On Cloudflare Workers, secrets set with `wrangler secret put` land in
 * `process.env` at request time via OpenNext. Locally, `.dev.vars` (workerd)
 * and `.env.local` (`next dev`) provide the same names.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WEBHOOK_SHARED_SECRET: z.string().min(8),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`server env validation failed — ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
