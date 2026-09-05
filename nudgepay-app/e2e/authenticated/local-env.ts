import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_SUPABASE_PORT = "54321";
const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"] as const;

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const split = line.indexOf("=");
        return split < 0 ? [line, ""] : [line.slice(0, split).trim(), line.slice(split + 1).trim()];
      })
      .filter(([key]) => key),
  );
}

export function assertLoopbackSupabase(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Authenticated E2E requires a valid local SUPABASE_URL; received ${JSON.stringify(urlString)}.`);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (!loopback || url.port !== LOCAL_SUPABASE_PORT) {
    throw new Error(
      `Authenticated E2E refuses non-local Supabase URL ${url.origin}. Expected loopback port ${LOCAL_SUPABASE_PORT}; hosted databases are never seeded or cleaned.`,
    );
  }
  return url;
}

export function loadLocalE2EEnv(): Record<string, string> {
  const examplePath = resolve(process.cwd(), ".env.test.example");
  if (!existsSync(examplePath)) {
    throw new Error("Authenticated E2E requires .env.test.example with the published local Supabase keys.");
  }

  const env = parseEnv(examplePath);
  const localOverridePath = resolve(process.cwd(), ".env.test");
  if (existsSync(localOverridePath)) {
    const overrides = parseEnv(localOverridePath);
    for (const key of REQUIRED) {
      if (overrides[key]) env[key] = overrides[key];
    }
  }

  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Authenticated E2E requires ${key} in .env.test.example or .env.test.`);
  }
  assertLoopbackSupabase(env.SUPABASE_URL);

  return {
    ...env,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    AUTH_RATE_LIMIT_REQUIRED: "false",
    CSP_MODE: "enforce",
    APP_PUBLIC_BASE_URL: "http://127.0.0.1:5173",
    TWILIO_PUBLIC_BASE_URL: "http://127.0.0.1:5173",
  };
}

export async function requireHealthyLocalSupabase(env = loadLocalE2EEnv()): Promise<void> {
  const url = assertLoopbackSupabase(env.SUPABASE_URL);
  let response: Response;
  try {
    response = await fetch(new URL("/auth/v1/health", url), { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      "Authenticated E2E requires the local Supabase stack. Run `npx supabase start` or use `node e2e/authenticated/run.mjs`.",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`Local Supabase auth health check failed with HTTP ${response.status}.`);
  }
}
