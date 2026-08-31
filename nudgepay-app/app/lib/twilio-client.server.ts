// Thin, injectable Twilio Messages API client. Raw REST (no Twilio SDK).
// Tests pass a mock fetchFn; routes pass the global fetch. No node:* imports.

export type TwilioConfig = { accountSid: string; authToken: string };
export type TwilioSender = { messagingServiceSid: string } | { from: string };
export type TwilioSendResult = { sid: string; status: string };

/** Hung Twilio must fail closed instead of waiting out the Worker. */
export const SMS_SEND_TIMEOUT_MS = 10_000;

export async function sendSms(
  fetchFn: typeof fetch,
  cfg: TwilioConfig,
  params: { to: string; body: string; sender: TwilioSender; statusCallback?: string | null; idempotencyKey?: string },
): Promise<TwilioSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", params.to);
  form.set("Body", params.body);
  if ("messagingServiceSid" in params.sender) {
    form.set("MessagingServiceSid", params.sender.messagingServiceSid);
  } else {
    form.set("From", params.sender.from);
  }
  if (params.statusCallback) form.set("StatusCallback", params.statusCallback);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    Authorization: "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`),
  };
  if (params.idempotencyKey) headers["Idempotency-Key"] = params.idempotencyKey;

  const res = await fetchFn(url, {
    method: "POST",
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(SMS_SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
  const data = (await res.json()) as { sid: string; status: string };
  return { sid: data.sid, status: data.status };
}
