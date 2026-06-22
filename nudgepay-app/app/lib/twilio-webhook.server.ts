// Twilio webhook signature verification. Twilio signs (URL + POST params
// sorted by key, concatenated as key+value) with HMAC-SHA1 keyed by the
// account Auth Token, base64-encoded, sent as X-Twilio-Signature.
// Web Crypto (Workers + Node 20+/vitest). No node:crypto.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function twilioSignatureBase(url: string, params: Record<string, string>): string {
  let base = url;
  for (const key of Object.keys(params).sort()) base += key + params[key];
  return base;
}

export async function signTwilioRequest(
  authToken: string, url: string, params: Record<string, string>,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(twilioSignatureBase(url, params)));
  return b64encode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = await signTwilioRequest(authToken, url, params);
  return timingSafeEqual(expected, header);
}

export function parseTwilioForm(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) out[k] = v;
  return out;
}
