// Pure operator-alert helpers. No I/O.

import { safeErrorDetails, safeUrlForLog, type SafeErrorDetails } from "./log-redaction";

type WorkerErrorAlertPayload = {
  source: "nudgepay";
  event: "unhandled_worker_error";
  handler: "fetch" | "scheduled";
  error: SafeErrorDetails;
  cron?: string;
  url?: string;
};

type ProviderAttemptStaleAlertPayload = {
  source: "nudgepay";
  event: "provider_attempt_stale";
  channel: "sms" | "email" | "stripe_checkout";
  attemptId: string;
};

export type OperatorAlertPayload = WorkerErrorAlertPayload | ProviderAttemptStaleAlertPayload;

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
  const payload: WorkerErrorAlertPayload = {
    source: "nudgepay",
    event: "unhandled_worker_error",
    handler: input.handler,
    error: safeErrorDetails(input.err),
  };
  if (input.cron) payload.cron = input.cron;
  if (input.url) payload.url = safeUrlForLog(input.url);
  return payload;
}

export function providerAttemptStaleAlertPayload(input: {
  channel: "sms" | "email" | "stripe_checkout";
  attemptId: string;
}): ProviderAttemptStaleAlertPayload {
  return { source: "nudgepay", event: "provider_attempt_stale", channel: input.channel, attemptId: input.attemptId };
}
