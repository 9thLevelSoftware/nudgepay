// Thin, injectable Twilio Messages API client. Raw REST (no Twilio SDK).
// Tests pass a mock fetchFn; routes pass the global fetch. No node:* imports.

export type TwilioConfig = { accountSid: string; authToken: string };
export type TwilioSender = { messagingServiceSid: string } | { from: string };
export type TwilioSendResult = { sid: string; status: string };

export async function sendSms(
  fetchFn: typeof fetch,
  cfg: TwilioConfig,
  params: { to: string; body: string; sender: TwilioSender; statusCallback?: string | null },
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

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`),
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
  const data = (await res.json()) as { sid: string; status: string };
  return { sid: data.sid, status: data.status };
}
