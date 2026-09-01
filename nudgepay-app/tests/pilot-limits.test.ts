import { expect, test } from "vitest";
import { PILOT_LIMIT_LINES, PILOT_MAX_LIST_ROWS, WORKSPACES_PER_USER_CAP } from "../app/lib/pilot-limits";
import { PAGE_ALL_MAX_ROWS } from "../app/lib/page-all";

test("pilot list cap is the shared page-all cap", () => {
  expect(PILOT_MAX_LIST_ROWS).toBe(PAGE_ALL_MAX_ROWS);
  expect(PILOT_MAX_LIST_ROWS).toBe(5000);
  expect(WORKSPACES_PER_USER_CAP).toBe(20);
});

test("pilot limit copy is explicit and not automation", () => {
  expect(PILOT_LIMIT_LINES.length).toBeGreaterThanOrEqual(4);
  expect(PILOT_LIMIT_LINES.join(" ")).toMatch(/5,000/);
  expect(PILOT_LIMIT_LINES.join(" ").toLowerCase()).toMatch(/human follow-up queue/);
  expect(PILOT_LIMIT_LINES.join(" ").toLowerCase()).toMatch(/not automatic payment reminders/);
  expect(PILOT_LIMIT_LINES.join(" ").toLowerCase()).toMatch(/payment portal url is your own page/);
  expect(PILOT_LIMIT_LINES.join(" ").toLowerCase()).toMatch(/does not charge customers/);
});
