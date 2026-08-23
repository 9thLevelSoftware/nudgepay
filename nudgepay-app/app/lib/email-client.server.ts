// Resend REST client. Workers-friendly (fetch-only, no SDK). Fetch injected for
// testability, mirroring twilio-client.server.ts.

export type EmailConfig = { apiKey: string; allowedFrom?: string | null };
export type SendEmailArgs = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  // Only set when a received mailbox exists. There is no inbound mailbox env today.
  replyTo?: string;
};

export async function sendEmail(
  fetchFn: typeof fetch, cfg: EmailConfig, args: SendEmailArgs & { idempotencyKey?: string },
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = { from: args.from, to: args.to, subject: args.subject };
  if (args.html) payload.html = args.html;
  if (args.text) payload.text = args.text;
  if (args.replyTo) payload.reply_to = args.replyTo;
  if (args.headers && Object.keys(args.headers).length > 0) payload.headers = args.headers;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey;
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${text}`);
  }
  const json = text ? JSON.parse(text) : {};
  return { id: (json.id as string) ?? "" };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function firstAddr(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return firstAddr(v[0]);
  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    if (typeof rec.address === "string") return rec.address;
    if (typeof rec.email === "string") return rec.email;
  }
  return "";
}

export async function fetchReceivingEmail(
  fetchFn: typeof fetch,
  cfg: EmailConfig,
  receivingId: string,
  signal?: AbortSignal,
): Promise<{ text: string; html: string; from: string; to: string; subject: string } | null> {
  const res = await fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(receivingId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    signal: signal ?? AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend receiving fetch failed (${res.status}): ${body}`);
  }
  const json = body ? JSON.parse(body) : {};
  return {
    text: str(json.text),
    html: str(json.html),
    from: firstAddr(json.from),
    to: firstAddr(json.to),
    subject: str(json.subject),
  };
}
