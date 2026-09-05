// Shared .env.test loader for Vitest globalSetup and integration helpers.
// Pure unit tests must not import this file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_TEST_HINT =
  "Missing nudgepay-app/.env.test. Copy .env.test.example, run `npx supabase start`, then `npx vitest run`. Use `npm run test:unit` for tests that do not need a database.";

// The integration suite's global setup truncates data and deletes test auth
// users. Keep its target deliberately narrower than "a local-looking URL".
const LOCAL_SUPABASE_PORTS = new Set(["54321"]);

export function assertLocalSupabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) throw new Error("Test setup requires SUPABASE_URL.");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Refusing destructive test setup: SUPABASE_URL must be an exact local loopback URL.");
  }

  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
    !LOCAL_SUPABASE_PORTS.has(url.port)
  ) {
    throw new Error(
      "Refusing destructive test setup: SUPABASE_URL must be http://127.0.0.1:54321 (or http://[::1]:54321), without credentials or path.",
    );
  }
  return url.toString();
}

export function assertSafeTestEnv(env: Record<string, string>): void {
  assertLocalSupabaseUrl(env.SUPABASE_URL);
  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("Test setup requires local SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY.");
  }
}

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
  assertSafeTestEnv(env);
  return env;
}
