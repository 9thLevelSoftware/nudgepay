import { expect, test } from "vitest";
import { getQboEnv, getQboEnvOrNull } from "../app/lib/env.server";

function ctx(env: Record<string, string>) {
  return { cloudflare: { env } };
}

const complete = {
  QBO_CLIENT_ID: "id",
  QBO_CLIENT_SECRET: "secret",
  QBO_REDIRECT_URI: "https://example.com/auth/qbo/callback",
  QBO_ENCRYPTION_KEY: "key",
  QBO_WEBHOOK_VERIFIER_TOKEN: "tok",
};

test("getQboEnvOrNull returns null when any required var is missing", () => {
  expect(getQboEnvOrNull(ctx({}))).toBeNull();
  expect(getQboEnvOrNull(ctx({ ...complete, QBO_CLIENT_ID: "" }))).toBeNull();
  expect(getQboEnvOrNull(ctx({ ...complete, QBO_WEBHOOK_VERIFIER_TOKEN: "" }))).toBeNull();
});

test("getQboEnvOrNull returns config when all required vars are set", () => {
  const qbo = getQboEnvOrNull(ctx({ ...complete, QBO_SANDBOX: "false" }));
  expect(qbo).not.toBeNull();
  expect(qbo!.QBO_CLIENT_ID).toBe("id");
  expect(qbo!.QBO_SANDBOX).toBe(false);
});

test("getQboEnvOrNull defaults sandbox to true unless QBO_SANDBOX is 'false'", () => {
  expect(getQboEnvOrNull(ctx(complete))!.QBO_SANDBOX).toBe(true);
  expect(getQboEnvOrNull(ctx({ ...complete, QBO_SANDBOX: "true" }))!.QBO_SANDBOX).toBe(true);
});

test("getQboEnv throws when unconfigured", () => {
  expect(() => getQboEnv(ctx({}))).toThrow(/Missing required QBO/);
});
