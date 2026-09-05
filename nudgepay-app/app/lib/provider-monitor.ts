// Pure provider-monitor rules. Attempt IDs are the only provider-record fields
// eligible for an operator alert; customer and provider payload fields never
// enter this module's output.

export const PROVIDER_MONITOR_STALE_AFTER_MS = 5 * 60 * 1000;
export const PROVIDER_MONITOR_RETENTION_DAYS = 30;
export const PROVIDER_MONITOR_LIMIT = 25;

export type ProviderMonitorChannel = "sms" | "email" | "stripe_checkout";
export type ProviderMonitorCandidate = {
  channel: ProviderMonitorChannel;
  attemptId: string;
  updatedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function providerMonitorHourBucket(now: Date): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function isStaleProviderAttempt(updatedAt: string, now: Date, thresholdMs = PROVIDER_MONITOR_STALE_AFTER_MS): boolean {
  const updated = Date.parse(updatedAt);
  return Number.isFinite(updated) && now.getTime() - updated >= thresholdMs;
}

/** Drops malformed IDs and timestamps before they can enter a pager payload. */
export function staleProviderCandidates(candidates: ProviderMonitorCandidate[], now: Date): ProviderMonitorCandidate[] {
  return candidates.filter((candidate) => UUID.test(candidate.attemptId) && isStaleProviderAttempt(candidate.updatedAt, now));
}

export function providerMonitorRetentionCutoff(now: Date): string {
  return new Date(now.getTime() - PROVIDER_MONITOR_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
