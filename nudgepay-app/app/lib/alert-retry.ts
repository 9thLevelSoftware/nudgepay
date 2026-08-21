// Pure: only a successful ledger row skips a broken-promise alert.
// Failures must remain retryable (no success row).

export function shouldSkipBrokenPromiseSend(existingSuccessCount: number): boolean {
  return existingSuccessCount > 0;
}
