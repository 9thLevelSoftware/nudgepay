// Svix webhook signature verification (Resend). Signed content is
// `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64-decoded
// secret (the part after "whsec_"). svix-signature is space-separated
// "v1,<b64sig>" entries; accept if any matches. Web Crypto only (no node:crypto).

const FIVE_MIN_MS = 5 * 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(nowMs - tsSec * 1000) > FIVE_MIN_MS) return false;

  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = new Uint8Array(Array.from(atob(secretB64), c => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = b64encode(new Uint8Array(sig));

  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const value = comma >= 0 ? part.slice(comma + 1) : part;
    if (timingSafeEqual(expected, value)) return true;
  }
  return false;
}
