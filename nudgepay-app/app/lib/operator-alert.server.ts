// Fail-open operator paging. Never throw to the caller — missing webhook or
// a down pager must not fail cron or HTTP.

import {
  operatorAlertPayload,
  operatorAlertWebhookOk,
  type OperatorAlertPayload,
} from "./operator-alert";

export async function postOperatorAlert(
  fetchFn: typeof fetch,
  webhookUrl: unknown,
  payload: OperatorAlertPayload,
): Promise<boolean> {
  if (!operatorAlertWebhookOk(webhookUrl)) return false;
  try {
    const res = await fetchFn(webhookUrl.trim(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function alertFromWorkerError(
  fetchFn: typeof fetch,
  env: Record<string, string>,
  input: { handler: "fetch" | "scheduled"; err: unknown; cron?: string; url?: string },
): Promise<boolean> {
  return postOperatorAlert(
    fetchFn,
    env.OPERATOR_ALERT_WEBHOOK,
    operatorAlertPayload(input),
  );
}
