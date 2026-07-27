import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // `server-only` throws in non-Next test envs; stub it out so we can
      // exercise the same server module the route handler imports.
      "server-only": resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests hit local Supabase serially so committed-stock
    // deltas are deterministic within a run.
    poolOptions: { threads: { singleThread: true } },
  },
});
