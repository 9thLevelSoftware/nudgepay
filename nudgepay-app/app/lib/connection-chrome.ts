// Pure QBO connection chrome. No I/O. Token death is discovered on
// CDC/webhook/manual refresh (status: "error") — page load does not probe Intuit.

export type ConnectionChrome =
  | { kind: "not_connected" }
  | { kind: "needs_reconnect" }
  | { kind: "connected"; lastSyncAt: string | null; truncated?: boolean };

export type ConnectionKind = ConnectionChrome["kind"];

export function connectionChrome(
  status: string | null | undefined,
  lastSyncAt: string | null,
): ConnectionChrome {
  if (status === "error") return { kind: "needs_reconnect" };
  if (status === "connected") return { kind: "connected", lastSyncAt };
  return { kind: "not_connected" };
}

export function connectionSyncLabel(chrome: ConnectionChrome, nowMs: number = Date.now()): string {
  if (chrome.kind === "needs_reconnect") return "Needs reconnect";
  if (chrome.kind === "not_connected") return "Not connected";
  if (!chrome.lastSyncAt) return "Connected";
  const diffMs = nowMs - new Date(chrome.lastSyncAt).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 2) return "Synced just now";
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  if (diffHr < 24) return `Synced ${diffHr}h ago`;
  return `Synced ${diffDay}d ago`;
}
