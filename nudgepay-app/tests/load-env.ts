// Shared .env.test loader for Vitest globalSetup and integration helpers.
// Pure unit tests must not import this file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_TEST_HINT =
  "Missing nudgepay-app/.env.test. Copy .env.test.example, run `npx supabase start`, then `npx vitest run`. Use `npm run test:unit` for tests that do not need a database.";

export function loadTestEnv(fromUrl: string = import.meta.url): Record<string, string> {
  const dir = dirname(fileURLToPath(fromUrl));
  const envPath = join(dir, "../.env.test");
  if (!existsSync(envPath)) {
    throw new Error(ENV_TEST_HINT);
  }
  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}
