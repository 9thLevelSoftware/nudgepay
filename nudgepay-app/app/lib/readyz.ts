// Pure /readyz body. Process liveness stays on /healthz. This route is
// database + config presence — not live QBO/Twilio/Resend probes.

export type ReadyzProviders = {
  qbo: boolean;
  twilio: boolean;
  email: boolean;
  operatorAlert: boolean;
};

export type ReadyzBody = {
  ok: boolean;
  reason?: string;
  providers: ReadyzProviders;
};

export function readyzBody(input: {
  ok: boolean;
  reason?: string;
  providers: ReadyzProviders;
}): ReadyzBody {
  const body: ReadyzBody = { ok: input.ok, providers: input.providers };
  if (!input.ok && input.reason) body.reason = input.reason;
  return body;
}
