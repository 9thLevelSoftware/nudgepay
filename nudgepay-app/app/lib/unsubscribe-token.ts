// HMAC-signed unsubscribe token: base64url(payload) + "." + base64url(hmac).
// payload = JSON {o: orgId, c: customerId}. No expiry (opt-out links must keep
// working). Web Crypto only (Workers + vitest), no node:crypto.

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}
function stringFromB64url(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signUnsubscribeToken(secret: string, orgId: string, customerId: string): Promise<string> {
  const payload = b64urlFromString(JSON.stringify({ o: orgId, c: customerId }));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyUnsubscribeToken(
  secret: string, token: string,
): Promise<{ orgId: string; customerId: string } | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const obj = JSON.parse(stringFromB64url(payload));
    if (typeof obj.o !== "string" || typeof obj.c !== "string") return null;
    return { orgId: obj.o, customerId: obj.c };
  } catch {
    return null;
  }
}
