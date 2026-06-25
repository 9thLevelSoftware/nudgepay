import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    environment: "node",
    setupFiles: [],
    globalSetup: ["tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests share a single local Supabase DB; run files serially so
    // concurrent runScheduledCdc calls in qbo-cron.test.ts and
    // sync-errors-wiring.test.ts don't cross-contaminate each other's
    // sync_errors rows (both call the cron which sweeps ALL connected orgs).
    sequence: { concurrent: false },
  },
});
