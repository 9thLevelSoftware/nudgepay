import { expect, test } from "vitest";
import { mapSyncIssues } from "../app/lib/workspace.server";

test("mapSyncIssues returns empty for missing rows", () => {
  expect(mapSyncIssues(null)).toEqual([]);
  expect(mapSyncIssues(undefined)).toEqual([]);
});

test("mapSyncIssues maps occurred_at to occurredAt", () => {
  expect(mapSyncIssues([
    { id: "1", source: "cron", scope: "cdc", message: "boom", occurred_at: "2026-08-20T00:00:00Z" },
  ])).toEqual([
    { id: "1", source: "cron", scope: "cdc", message: "boom", occurredAt: "2026-08-20T00:00:00Z" },
  ]);
});
