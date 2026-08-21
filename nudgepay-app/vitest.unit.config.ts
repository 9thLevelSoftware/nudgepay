import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Integration files import tests/helpers.ts (local Supabase). Keep this list
// derived from source so a new *-rls / API test is excluded automatically.
function integrationFiles(): string[] {
  const dir = path.resolve(__dirname, "tests");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => fs.readFileSync(path.join(dir, f), "utf8").includes('from "./helpers"'))
    .map((f) => `tests/${f}`);
}

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    environment: "node",
    setupFiles: [],
    globalSetup: [],
    include: ["tests/**/*.test.ts"],
    exclude: integrationFiles(),
  },
});
