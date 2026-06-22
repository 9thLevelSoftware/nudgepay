// QBO webhook signature verification + payload parsing.
// Intuit signs the raw request body with HMAC-SHA256 (key = the app's webhook
// verifier token) and sends base64(signature) in the `intuit-signature` header.
// Uses Web Crypto (Workers + Node 20+/vitest). No node:crypto.

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function signQboPayload(rawBody: string, verifierToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(verifierToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return b64encode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyQboSignature(
  rawBody: string, signatureHeader: string | null, verifierToken: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await signQboPayload(rawBody, verifierToken);
  return timingSafeEqual(expected, signatureHeader);
}

export type QboWebhookEntity = {
  realmId: string;
  entityName: string;
  id: string;
  operation: string;
};

export function parseQboWebhook(rawBody: string): QboWebhookEntity[] {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const out: QboWebhookEntity[] = [];
  for (const n of payload?.eventNotifications ?? []) {
    const realmId = String(n.realmId);
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      out.push({
        realmId,
        entityName: String(e.name),
        id: String(e.id),
        operation: String(e.operation),
      });
    }
  }
  return out;
}
