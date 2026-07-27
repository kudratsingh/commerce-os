import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext build output — generated Worker bundle, not our code.
    ".open-next/**",
    // Generated Supabase types.
    "lib/db/database.types.ts",
    // Separate Cloudflare Worker with its own tsconfig / lint config.
    "cron-worker/**",
  ]),
]);

export default eslintConfig;
