import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
    globalSetup: ["tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
