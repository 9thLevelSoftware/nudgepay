// Structured unhandled-error logs for Cloudflare Workers Logs (JSON fields are indexed).
import { safeErrorDetails, safePathForLog } from "./log-redaction";

export type WorkerHandlerKind = "fetch" | "scheduled";

export type WorkerErrorContext = {
  url?: string;
  method?: string;
  requestId?: string;
  cron?: string;
};

export function logUnhandledWorkerError(
  handler: WorkerHandlerKind,
  context: WorkerErrorContext,
  err: unknown,
): void {
  console.error({
    event: "unhandled_worker_error",
    handler,
    method: context.method,
    path: context.url ? safePathForLog(context.url) : undefined,
    requestId: context.requestId,
    cron: context.cron,
    ...safeErrorDetails(err),
  });
}

export async function withUnhandledLogging<T>(
  handler: WorkerHandlerKind,
  context: WorkerErrorContext,
  fn: () => Promise<T>,
  opts?: { onError?: (err: unknown) => Promise<void> },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logUnhandledWorkerError(handler, context, err);
    if (opts?.onError) {
      try {
        await opts.onError(err);
      } catch {
        // Pager failure must not replace the original error.
      }
    }
    throw err;
  }
}
