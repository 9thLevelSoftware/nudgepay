import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  summarizeRecentContact, liveViewers, collisionState,
  RECENT_WINDOW_MIN, PRESENCE_FRESH_SEC,
} from "../app/lib/collision";

const ME = "user-me";
const JANE = "user-jane";
const BOB = "user-bob";
const NOW = Date.parse("2026-06-25T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const secondsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();
const label = (id: string) => ({ [JANE]: "Jane", [BOB]: "Bob", [ME]: "Me" }[id] ?? "A teammate");

test("summarizeRecentContact picks the latest different-user contact and flags the window", () => {
  const r = summarizeRecentContact(
    [{ userId: JANE, at: minutesAgo(10) }, { userId: BOB, at: minutesAgo(90) }],
    ME, NOW,
  );
  expect(r).toEqual({ userId: JANE, at: minutesAgo(10), withinWindow: true });
});

test("summarizeRecentContact ignores my own contacts and null-user (automated) contacts", () => {
  const r = summarizeRecentContact(
    [{ userId: ME, at: minutesAgo(1) }, { userId: null, at: minutesAgo(2) }, { userId: JANE, at: minutesAgo(5) }],
    ME, NOW,
  );
  expect(r?.userId).toBe(JANE);
});

test("summarizeRecentContact returns null when only my own / automated contacts exist", () => {
  expect(summarizeRecentContact([{ userId: ME, at: minutesAgo(1) }, { userId: null, at: minutesAgo(2) }], ME, NOW)).toBeNull();
});

test(`summarizeRecentContact flags withinWindow=false past ${RECENT_WINDOW_MIN}m`, () => {
  const r = summarizeRecentContact([{ userId: JANE, at: minutesAgo(RECENT_WINDOW_MIN + 1) }], ME, NOW);
  expect(r?.withinWindow).toBe(false);
});

test("liveViewers returns fresh non-self viewers, deduped", () => {
  const live = liveViewers(
    [
      { userId: JANE, lastSeenAt: secondsAgo(5) },
      { userId: JANE, lastSeenAt: secondsAgo(10) },
      { userId: BOB, lastSeenAt: secondsAgo(PRESENCE_FRESH_SEC + 5) }, // stale
      { userId: ME, lastSeenAt: secondsAgo(1) },                       // self
    ],
    ME, NOW,
  );
  expect(live).toEqual([JANE]);
});

test("collisionState: live wins over recent", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(5) }],
    heartbeats: [{ userId: JANE, lastSeenAt: secondsAgo(3) }],
    currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("live");
  expect(c.byUser).toBe("Jane");
  expect(c.liveUsers).toEqual(["Jane"]);
});

test("collisionState: recent within window when nobody live", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(5) }], heartbeats: [], currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("recent");
  expect(c.byUser).toBe("Bob");
  expect(c.recentAt).toBe(minutesAgo(5));
});

test("collisionState: none past the window, but still exposes byUser for passive display", () => {
  const c = collisionState({
    contacts: [{ userId: BOB, at: minutesAgo(RECENT_WINDOW_MIN + 30) }], heartbeats: [], currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("none");
  expect(c.byUser).toBe("Bob");
});

test("collisionState: clean none when no signals", () => {
  const c = collisionState({ contacts: [], heartbeats: [], currentUserId: ME, nowMs: NOW, label });
  expect(c).toEqual({ level: "none", byUser: null, recentAt: null, liveUsers: [] });
});

test("DetailPanel heartbeat POSTs presence and does not revalidate the dashboard", () => {
  const src = readFileSync(new URL("../app/components/DetailPanel.tsx", import.meta.url), "utf8");
  expect(src).toContain('fetch("/api/presence/heartbeat"');
  expect(src).toContain("beat(); // immediate");
  expect(src).toMatch(/setInterval\(\(\) => \{\s*if \(cancelled\) return;\s*beat\(\);\s*\}, HEARTBEAT_INTERVAL_MS\)/);
  expect(src).not.toMatch(/useRevalidator/);
  expect(src).not.toMatch(/revalidateRef/);
});

test("Focus heartbeat POSTs presence without revalidating", () => {
  const src = readFileSync(new URL("../app/routes/focus.tsx", import.meta.url), "utf8");
  expect(src).toContain('fetch("/api/presence/heartbeat"');
  expect(src).toMatch(/setInterval\(\(\) => \{\s*if \(cancelled\) return;\s*beat\(\);\s*\}, HEARTBEAT_MS\)/);
  expect(src).not.toMatch(/useRevalidator/);
  expect(src).not.toMatch(/revalidate\(/);
});

test("Focus send/log require confirm on live or recent collision (dashboard parity)", () => {
  const focus = readFileSync(new URL("../app/routes/focus.tsx", import.meta.url), "utf8");
  const send = readFileSync(new URL("../app/components/focus/SendTextMiniForm.tsx", import.meta.url), "utf8");
  const log = readFileSync(new URL("../app/components/focus/LogCallMiniForm.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../app/components/DetailPanel.tsx", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("../app/components/LogContactDrawer.tsx", import.meta.url), "utf8");

  expect(focus).toContain("collisionState");
  expect(focus).toContain("dropLivePresenceCases");
  expect(focus).toContain("recentByCase");
  expect(focus).toContain("collision={collisions[currentItem.caseId] ?? null}");

  expect(send).toContain("collision: Collision | null");
  expect(send).toContain("const needsConfirm = !!collision && collision.level !== \"none\"");
  expect(send).toMatch(/if \(needsConfirm && !confirmSend\)/);
  expect(send).toContain("is viewing this customer now. Send anyway?");
  expect(send).toContain("contacted this customer recently. Send anyway?");
  expect(send).toContain('role="alert"');

  expect(log).toContain("collision: Collision | null");
  expect(log).toContain("const needsConfirm = !!collision && collision.level !== \"none\"");
  expect(log).toMatch(/if \(needsConfirm && !confirmSave\)/);
  expect(log).toContain("is viewing this customer now. Log anyway?");
  expect(log).toContain("contacted this customer recently. Log anyway?");
  expect(log).toContain('role="alert"');

  expect(detail).toContain("is viewing this customer now. Send anyway?");
  expect(drawer).toContain("is viewing this customer now. Log anyway?");
});

test("recent-contact within RECENT_WINDOW_MIN is a collision that needs confirm", () => {
  const c = collisionState({
    contacts: [{ userId: JANE, at: minutesAgo(RECENT_WINDOW_MIN) }],
    heartbeats: [],
    currentUserId: ME, nowMs: NOW, label,
  });
  expect(c.level).toBe("recent");
  expect(c.level !== "none").toBe(true);
});
