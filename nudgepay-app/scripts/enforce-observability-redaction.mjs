import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
const WRANGLER_BIN = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

function redactionError(message) {
  return new Error(`Observability redaction verification failed: ${message}`);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw redactionError(`${label} returned an invalid response`);
  }
}

function containsExistingSettings(expected, actual) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => containsExistingSettings(value, actual[index]));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(
      ([key, value]) => containsExistingSettings(value, actual[key]),
    );
  }
  return Object.is(expected, actual);
}

function runWrangler(args, execFile = execFileSync, env = process.env) {
  try {
    return execFile(process.execPath, [WRANGLER_BIN, ...args], {
      encoding: "utf8",
      env,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch {
    throw redactionError("could not read Wrangler authentication context");
  }
}

export function resolveCloudflareCredentials({
  env = process.env,
  execFile = execFileSync,
} = {}) {
  let token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    const auth = parseJson(
      runWrangler(["auth", "token", "--json"], execFile, env),
      "wrangler auth token",
    );
    token = typeof auth?.token === "string" ? auth.token.trim() : "";
  }
  if (!token) throw redactionError("Wrangler did not provide an API token");

  let accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    const identity = parseJson(
      runWrangler(["whoami", "--json"], execFile, env),
      "wrangler whoami",
    );
    const accounts = Array.isArray(identity?.accounts) ? identity.accounts : [];
    if (accounts.length !== 1 || typeof accounts[0]?.id !== "string") {
      throw redactionError(
        "set CLOUDFLARE_ACCOUNT_ID when Wrangler can access more than one account",
      );
    }
    accountId = accounts[0].id;
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw redactionError("Cloudflare account id is invalid");
  }

  return { accountId, token };
}

async function requestScriptSettings({
  accountId,
  scriptName,
  token,
  method = "GET",
  body,
  fetchFn,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `${CLOUDFLARE_API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/script-settings`;

  try {
    let response;
    try {
      response = await fetchFn(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw redactionError("Cloudflare API timed out");
      throw redactionError("Cloudflare API request failed");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) throw redactionError("Cloudflare API timed out");
      throw redactionError("Cloudflare API returned an invalid response");
    }
    if (!response.ok || payload?.success !== true || !payload.result) {
      throw redactionError(`Cloudflare API rejected the ${method} request`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enforceObservabilityQueryRedaction({
  accountId,
  scriptName,
  token,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(scriptName ?? "")) {
    throw redactionError("Worker name is invalid");
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? "")) {
    throw redactionError("Cloudflare account id is invalid");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw redactionError("API token is missing");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw redactionError("timeout must be positive");
  }

  const existing = await requestScriptSettings({
    accountId,
    scriptName,
    token,
    fetchFn,
    timeoutMs,
  });
  const observability = existing?.observability;
  if (!observability || typeof observability !== "object" || typeof observability.enabled !== "boolean") {
    throw redactionError("Worker observability settings are missing");
  }

  const patched = await requestScriptSettings({
    accountId,
    scriptName,
    token,
    method: "PATCH",
    body: {
      observability: {
        ...observability,
        redact_query_string: true,
      },
    },
    fetchFn,
    timeoutMs,
  });
  if (patched?.observability?.redact_query_string !== true) {
    throw redactionError("Cloudflare did not accept query-string redaction");
  }

  const verified = await requestScriptSettings({
    accountId,
    scriptName,
    token,
    fetchFn,
    timeoutMs,
  });
  if (verified?.observability?.redact_query_string !== true) {
    throw redactionError("query-string redaction was false after readback");
  }
  const { redact_query_string: _previousRedaction, ...settingsToPreserve } = observability;
  if (!containsExistingSettings(settingsToPreserve, verified.observability)) {
    throw redactionError("Cloudflare changed existing observability settings during the patch");
  }
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--worker" || !argv[1]) {
    throw redactionError("usage: enforce-observability-redaction.mjs --worker <name>");
  }
  return argv[1];
}

async function main() {
  const scriptName = parseArgs(process.argv.slice(2));
  try {
    const credentials = resolveCloudflareCredentials();
    await enforceObservabilityQueryRedaction({ scriptName, ...credentials });
    console.log(`Cloudflare query-string redaction verified for ${scriptName}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    console.error(
      `Worker upload completed, but ${message}. Treat this deployment as incomplete until the setting is repaired and verified.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
