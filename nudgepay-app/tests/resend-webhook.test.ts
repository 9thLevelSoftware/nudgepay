import { describe, it, expect } from "vitest";
import { verifyResendSignature } from "../app/lib/resend-webhook.server";

// Build a valid signature the way Svix does, so the test is self-contained.
async function signSvix(secretB64: string, id: string, ts: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  let s = ""; for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  return `v1,${btoa(s)}`;
}

const SECRET_B64 = btoa("super-secret-key-bytes");
const WHSEC = `whsec_${SECRET_B64}`;

describe("verifyResendSignature", () => {
  const id = "msg_1";
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
  it("accepts a valid signature within the time window", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body, now)).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body + "x", now)).toBe(false);
  });
  it("rejects a stale timestamp", async () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor((now - 10 * 60_000) / 1000));
    const sig = await signSvix(SECRET_B64, id, ts, body);
    expect(await verifyResendSignature(WHSEC, { id, timestamp: ts, signature: sig }, body, now)).toBe(false);
  });
  it("rejects a missing header", async () => {
    expect(await verifyResendSignature(WHSEC, { id: null, timestamp: "1", signature: "v1,x" }, body, 1)).toBe(false);
  });
});
