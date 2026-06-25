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
    // Integration tests share ONE local Supabase DB. Run test files serially:
    // qbo-cron.test.ts and sync-errors-wiring.test.ts both invoke runScheduledCdc,
    // which sweeps ALL connected qbo_connections, so parallel files cross-contaminate
    // each other's sync_errors rows. fileParallelism:false serializes files (the suite
    // is small; the few-seconds cost buys deterministic shared-DB tests).
    fileParallelism: false,
  },
});
