// Structured unhandled-error logs for Cloudflare Workers Logs (JSON fields are indexed).

export type WorkerHandlerKind = "fetch" | "scheduled";

export type WorkerErrorContext = {
  url?: string;
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
    url: context.url,
    cron: context.cron,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
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
