import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectionChrome, connectionSyncLabel } from "../app/lib/connection-chrome";
import { getConnectionStatus } from "../app/lib/qbo-connection.server";
import { inboxListCopy } from "../app/lib/message-inbox";
import { comingDueEmptyCopy } from "../app/lib/coming-due";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("connectionChrome", () => {
  it("maps missing and disconnected status to not_connected", () => {
    expect(connectionChrome(null, null)).toEqual({ kind: "not_connected" });
    expect(connectionChrome(undefined, "2026-08-01T00:00:00Z")).toEqual({ kind: "not_connected" });
    expect(connectionChrome("disconnected", null)).toEqual({ kind: "not_connected" });
  });

  it("maps error status to needs_reconnect on every surface", () => {
    expect(connectionChrome("error", "2026-08-01T00:00:00Z")).toEqual({ kind: "needs_reconnect" });
    expect(connectionSyncLabel(connectionChrome("error", null))).toBe("Needs reconnect");
  });

  it("maps connected status with last sync", () => {
    expect(connectionChrome("connected", "2026-08-01T00:00:00Z")).toEqual({
      kind: "connected", lastSyncAt: "2026-08-01T00:00:00Z",
    });
    expect(connectionChrome("connected", null)).toEqual({ kind: "connected", lastSyncAt: null });
  });

  it("never paints Connected for a dead token", () => {
    expect(connectionSyncLabel(connectionChrome("error", "2026-08-01T00:00:00Z")))
      .not.toBe("Connected");
    expect(connectionSyncLabel(connectionChrome("error", "2026-08-01T00:00:00Z")))
      .not.toBe("Not connected");
  });

  it("formats relative sync labels for a live connection", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    expect(connectionSyncLabel(connectionChrome("connected", null), now)).toBe("Connected");
    expect(connectionSyncLabel(
      connectionChrome("connected", "2026-08-21T11:59:00Z"), now,
    )).toBe("Synced just now");
    expect(connectionSyncLabel(
      connectionChrome("connected", "2026-08-21T11:10:00Z"), now,
    )).toBe("Synced 50m ago");
    expect(connectionSyncLabel(
      connectionChrome("connected", "2026-08-21T08:00:00Z"), now,
    )).toBe("Synced 4h ago");
    expect(connectionSyncLabel(
      connectionChrome("connected", "2026-08-19T12:00:00Z"), now,
    )).toBe("Synced 2d ago");
  });
});

describe("getConnectionStatus", () => {
  it("throws on query error instead of painting disconnected", async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: null, error: { message: "boom" } }) };
              },
            };
          },
        };
      },
    };
    await expect(getConnectionStatus(client as never, "org-1")).rejects.toEqual({ message: "boom" });
  });
});

describe("inboxListCopy distinguishability", () => {
  it("uses first-run copy when disconnected, not no-threads", () => {
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: false,
    })).toBe("Connect QuickBooks to load messages.");
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: false,
    })).not.toBe("No threads in this view.");
  });

  it("uses reconnect copy when the token is dead", () => {
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: false, needsReconnect: true,
    })).toBe("Reconnect QuickBooks to load messages.");
  });

  it("uses healthy-empty copy when connected with no filter", () => {
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: true,
    })).toBe("No conversations yet.");
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: true,
    })).not.toBe("Connect QuickBooks to load messages.");
  });

  it("uses filter-miss copy when a tab or search is on", () => {
    expect(inboxListCopy({
      loadError: null, truncated: false, rowCount: 0, connected: true, filterMiss: true,
    })).toBe("No threads in this view.");
  });

  it("keeps truncated copy distinct from empty", () => {
    expect(inboxListCopy({
      loadError: null, truncated: true, rowCount: 0, connected: true,
    })).toBe("Inbox may be incomplete.");
    expect(inboxListCopy({
      loadError: null, truncated: true, rowCount: 0, connected: true,
    })).not.toBe("No conversations yet.");
  });
});

describe("comingDueEmptyCopy distinguishability", () => {
  it("does not claim none-coming-due when disconnected", () => {
    expect(comingDueEmptyCopy(7, { connected: false }))
      .toBe("Connect QuickBooks to load overdue invoices.");
    expect(comingDueEmptyCopy(7, { connected: false }))
      .not.toMatch(/No invoices coming due/);
  });

  it("uses reconnect copy when the token is dead", () => {
    expect(comingDueEmptyCopy(7, { connected: false, needsReconnect: true }))
      .toBe("Reconnect QuickBooks to load invoices.");
  });
});

describe("surfaces share one chrome helper", () => {
  it("workspace, dashboard, settings, and account profile use connectionChrome", () => {
    for (const rel of [
      "../app/lib/workspace.server.ts",
      "../app/routes/dashboard.tsx",
      "../app/routes/accounts.$id.tsx",
    ]) {
      expect(read(rel), rel).toContain("connectionChrome");
      expect(read(rel), rel).toContain("connectionSyncLabel");
    }
    const settings = read("../app/routes/settings.tsx");
    expect(settings).toContain("needsReconnect");
    expect(settings).toContain("Needs reconnect");
    expect(settings).toContain("chromeSyncLabel");
  });

  it("error status is Needs reconnect off the dashboard", () => {
    const workspace = read("../app/lib/workspace.server.ts");
    expect(workspace).toContain("connectionChrome");
    expect(workspace).not.toMatch(/if \(!connected\) \{\s*syncLabel = "Not connected"/);
  });

  it("dashboard and focus throw on org-config read failure", () => {
    expect(read("../app/routes/dashboard.tsx")).not.toMatch(/loadOrgConfig\([^)]*\)\.catch\(\(\) => DEFAULT_ORG_CONFIG\)/);
    expect(read("../app/routes/focus.tsx")).not.toMatch(/loadOrgConfig\([^)]*\)\.catch\(\(\) => DEFAULT_ORG_CONFIG\)/);
    expect(read("../app/lib/case-queue.server.ts")).not.toMatch(/loadOrgConfig\([^)]*\)\.catch\(\(\) => DEFAULT_ORG_CONFIG\)/);
  });

  it("Focus keeps Stage-1 truncation distinct from Partial history", () => {
    const src = read("../app/routes/focus.tsx");
    expect(src).toContain("queueTruncatedMessage");
    expect(src).toContain("queueTruncationMessage(src.queueTruncation)");
    expect(src).not.toMatch(/lastContactTruncated \|\| src\.queueTruncated/);
    expect(src).toContain("Partial history");
  });
});
