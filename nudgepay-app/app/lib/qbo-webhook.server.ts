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

// Canonical entity casing keyed by the lowercase token Intuit uses in CloudEvents
// `type` strings (qbo.<entity>.<event>.v1).
const ENTITY_CASING: Record<string, string> = {
  invoice: "Invoice",
  customer: "Customer",
  payment: "Payment",
  creditmemo: "CreditMemo",
};

function parseLegacy(payload: any): QboWebhookEntity[] {
  const out: QboWebhookEntity[] = [];
  for (const n of payload?.eventNotifications ?? []) {
    const realmId = String(n.realmId);
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      out.push({ realmId, entityName: String(e.name), id: String(e.id), operation: String(e.operation) });
    }
  }
  return out;
}

function parseCloudEvents(payload: any): QboWebhookEntity[] {
  const events = Array.isArray(payload) ? payload : [payload];
  const out: QboWebhookEntity[] = [];
  for (const ev of events) {
    const type = typeof ev?.type === "string" ? ev.type : "";
    const m = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/.exec(type);
    if (!m) continue;
    const entityName = ENTITY_CASING[m[1]] ?? "";
    if (!entityName) continue;
    out.push({
      realmId: String(ev.intuitaccountid ?? ""),
      entityName,
      id: String(ev.intuitentityid ?? ""),
      operation: m[2],
    });
  }
  return out;
}

// Supports both the legacy eventNotifications shape and the newer CloudEvents
// shape during Intuit's transition. Detection: presence of `eventNotifications`.
// NOTE: confirm exact CloudEvents field casing/nesting against a real Intuit
// payload before production cutover; both parsers are kept regardless.
export function parseQboWebhook(rawBody: string): QboWebhookEntity[] {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.eventNotifications) {
    return parseLegacy(payload);
  }
  return parseCloudEvents(payload);
}
