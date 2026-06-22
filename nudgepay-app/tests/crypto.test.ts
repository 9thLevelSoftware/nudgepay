import { expect, test } from "vitest";
import { encryptSecret, decryptSecret } from "../app/lib/crypto.server";

// A fixed 32-byte (AES-256) base64 key for deterministic tests.
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

test("round-trips a secret", async () => {
  const ct = await encryptSecret("refresh-token-123", KEY);
  expect(ct).not.toContain("refresh-token-123"); // not plaintext
  expect(ct.startsWith("v1:")).toBe(true);
  expect(await decryptSecret(ct, KEY)).toBe("refresh-token-123");
});

test("two encryptions of the same plaintext differ (random IV)", async () => {
  const a = await encryptSecret("x", KEY);
  const b = await encryptSecret("x", KEY);
  expect(a).not.toBe(b);
});

test("decrypt with the wrong key fails", async () => {
  const ct = await encryptSecret("secret", KEY);
  const wrong = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
  await expect(decryptSecret(ct, wrong)).rejects.toThrow();
});

test("tampered ciphertext fails the auth tag", async () => {
  const ct = await encryptSecret("secret", KEY);
  const [v, iv, body] = ct.split(":");
  const mid = Math.floor(body.length / 2);
  const ch = body[mid];
  const swapped = ch === "A" ? "B" : "A"; // guaranteed different base64 char
  const tampered = `${v}:${iv}:${body.slice(0, mid)}${swapped}${body.slice(mid + 1)}`;
  await expect(decryptSecret(tampered, KEY)).rejects.toThrow();
});

test("rejects a key that is not 32 bytes", async () => {
  const shortKey = btoa("too-short"); // < 32 bytes
  await expect(encryptSecret("x", shortKey)).rejects.toThrow();
});
