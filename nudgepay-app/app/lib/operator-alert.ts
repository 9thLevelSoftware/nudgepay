// Pure operator-alert helpers. No I/O.

export type OperatorAlertPayload = {
  source: "nudgepay";
  event: "unhandled_worker_error";
  handler: "fetch" | "scheduled";
  message: string;
  cron?: string;
  url?: string;
};

export function operatorAlertWebhookOk(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("https://") && trimmed.length < 2048;
}

export function operatorAlertPayload(input: {
  handler: "fetch" | "scheduled";
  err: unknown;
  cron?: string;
  url?: string;
}): OperatorAlertPayload {
  const message = input.err instanceof Error ? input.err.message : String(input.err);
  const payload: OperatorAlertPayload = {
    source: "nudgepay",
    event: "unhandled_worker_error",
    handler: input.handler,
    message: message.slice(0, 500),
  };
  if (input.cron) payload.cron = input.cron;
  if (input.url) payload.url = input.url.slice(0, 500);
  return payload;
}
