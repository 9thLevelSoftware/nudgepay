// Shared .env.test loader for Vitest globalSetup and integration helpers.
// Pure unit tests must not import this file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_TEST_HINT =
  "Missing nudgepay-app/.env.test. Copy .env.test.example, run `npx supabase start`, then `npx vitest run`. Use `npm run test:unit` for tests that do not need a database.";

function parseEnvFile(envPath: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
      .filter(([k]) => k),
  );
}

export function loadTestEnv(fromUrl: string = import.meta.url): Record<string, string> {
  const dir = dirname(fileURLToPath(fromUrl));
  const examplePath = join(dir, "../.env.test.example");
  const envPath = join(dir, "../.env.test");
  if (!existsSync(envPath) && !existsSync(examplePath)) {
    throw new Error(ENV_TEST_HINT);
  }
  // Example supplies QBO/Twilio/crypto fakes. Overlay only local Supabase
  // keys so a laptop .env.test cannot replace the test encryption key with a
  // production value that is not URL-safe base64.
  const env = existsSync(examplePath) ? parseEnvFile(examplePath) : {};
  const localOnly = new Set(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]);
  if (existsSync(envPath)) {
    for (const [k, v] of Object.entries(parseEnvFile(envPath))) {
      if (v !== "" && (!existsSync(examplePath) || localOnly.has(k))) env[k] = v;
    }
  }
  return env;
}
