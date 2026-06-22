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
  const parts = ct.split(":");
  const flipped = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "B=" : "A=");
  await expect(decryptSecret(`v1:${parts[1]}:${flipped}`, KEY)).rejects.toThrow();
});
