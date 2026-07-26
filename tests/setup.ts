/**
 * Vitest global setup. Loads `.env.local` into `process.env` so tests can
 * hit local Supabase without a dotenv dependency.
 *
 * Existing env values win — CI provides its own env, `.env.local` is a
 * developer convenience.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  const contents = readFileSync(envFile, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
