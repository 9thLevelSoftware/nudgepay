// Pure collision derivation for C1. No I/O, no node:*, no .server suffix
// (imported by the dashboard loader, client components via type-only imports, and tests).

export const RECENT_WINDOW_MIN = 60;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const PRESENCE_FRESH_SEC = 45;

export type RecentContactInput = { userId: string | null; at: string }; // at = ISO
export type HeartbeatInput = { userId: string; lastSeenAt: string };     // ISO

export type CollisionLevel = "none" | "recent" | "live";

export type Collision = {
  level: CollisionLevel;
  byUser: string | null;     // display label of the most relevant colliding teammate
  recentAt: string | null;   // ISO of the recent different-user contact (for "12m ago")
  liveUsers: string[];       // distinct labels viewing now (excludes self)
};

// Latest contact by a user other than currentUserId (null-user contacts are
// automated/inbound and ignored for attribution). withinWindow = within RECENT_WINDOW_MIN.
export function summarizeRecentContact(
  contacts: RecentContactInput[], currentUserId: string, nowMs: number,
): { userId: string; at: string; withinWindow: boolean } | null {
  let best: { userId: string; at: string } | null = null;
  for (const c of contacts) {
    if (!c.userId || c.userId === currentUserId) continue;
    if (!best || c.at > best.at) best = { userId: c.userId, at: c.at };
  }
  if (!best) return null;
  const ageMin = (nowMs - Date.parse(best.at)) / 60_000;
  return { ...best, withinWindow: ageMin <= RECENT_WINDOW_MIN };
}

// Distinct non-self userIds whose last heartbeat is within PRESENCE_FRESH_SEC.
export function liveViewers(
  heartbeats: HeartbeatInput[], currentUserId: string, nowMs: number,
): string[] {
  const live = new Set<string>();
  for (const h of heartbeats) {
    if (h.userId === currentUserId) continue;
    const ageSec = (nowMs - Date.parse(h.lastSeenAt)) / 1000;
    if (ageSec <= PRESENCE_FRESH_SEC) live.add(h.userId);
  }
  return [...live];
}

export function collisionState(args: {
  contacts: RecentContactInput[];
  heartbeats: HeartbeatInput[];
  currentUserId: string;
  nowMs: number;
  label: (userId: string) => string;
}): Collision {
  const { contacts, heartbeats, currentUserId, nowMs, label } = args;
  const live = liveViewers(heartbeats, currentUserId, nowMs);
  const recent = summarizeRecentContact(contacts, currentUserId, nowMs);
  const liveUsers = live.map(label);

  if (live.length > 0) {
    return { level: "live", byUser: liveUsers[0], recentAt: recent?.at ?? null, liveUsers };
  }
  if (recent && recent.withinWindow) {
    return { level: "recent", byUser: label(recent.userId), recentAt: recent.at, liveUsers: [] };
  }
  return {
    level: "none",
    byUser: recent ? label(recent.userId) : null,
    recentAt: recent?.at ?? null,
    liveUsers: [],
  };
}
