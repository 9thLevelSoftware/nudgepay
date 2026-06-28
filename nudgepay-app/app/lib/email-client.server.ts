// Resend REST client. Workers-friendly (fetch-only, no SDK). Fetch injected for
// testability, mirroring twilio-client.server.ts.

export type EmailConfig = { apiKey: string };
export type SendEmailArgs = { from: string; to: string; subject: string; text: string };

export async function sendEmail(
  fetchFn: typeof fetch, cfg: EmailConfig, args: SendEmailArgs,
): Promise<{ id: string }> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: args.from, to: args.to, subject: args.subject, text: args.text }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${text}`);
  }
  const json = text ? JSON.parse(text) : {};
  return { id: (json.id as string) ?? "" };
}
