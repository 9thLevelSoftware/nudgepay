import { expect, test } from "vitest";
import { parseOrgSettingsUpdate, parseHolidayDate } from "../app/lib/org-settings";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const valid: Array<[string, string]> = [
  ["promise_grace_days", "3"],
  ["working_days", "1"], ["working_days", "2"], ["working_days", "3"], ["working_days", "4"], ["working_days", "5"],
  ["cadence_critical", "2"], ["cadence_high", "3"], ["cadence_medium", "7"], ["cadence_low", "14"],
];

test("parseOrgSettingsUpdate accepts a valid form and sorts/dedupes working days", () => {
  const r = parseOrgSettingsUpdate(fd([["working_days", "5"], ["working_days", "1"], ["working_days", "1"],
    ["promise_grace_days", "3"], ["cadence_critical", "2"], ["cadence_high", "3"], ["cadence_medium", "7"], ["cadence_low", "14"]]));
  expect(r).toEqual({ ok: true, patch: {
    promise_grace_days: 3, working_days: [1, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
  } });
});

test("grace of 0 is allowed; negative is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "0"] : [k, v])))).toMatchObject({ ok: true });
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "-1"] : [k, v])))).toEqual({ ok: false, error: "grace" });
});

test("non-integer / missing grace is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.filter(([k]) => k !== "promise_grace_days")))).toEqual({ ok: false, error: "grace" });
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "2.5"] : [k, v])))).toEqual({ ok: false, error: "grace" });
});

test("empty or out-of-range working days are rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.filter(([k]) => k !== "working_days")))).toEqual({ ok: false, error: "working_days" });
  expect(parseOrgSettingsUpdate(fd([...valid.filter(([k]) => k !== "working_days"), ["working_days", "7"]]))).toEqual({ ok: false, error: "working_days" });
});

test("a non-positive cadence is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "cadence_high" ? [k, "0"] : [k, v])))).toEqual({ ok: false, error: "cadence" });
});

test("parseHolidayDate accepts a real YYYY-MM-DD and rejects junk", () => {
  expect(parseHolidayDate("2026-07-04")).toBe("2026-07-04");
  expect(parseHolidayDate("2026-02-31")).toBe(null); // not a real calendar day
  expect(parseHolidayDate("07/04/2026")).toBe(null);
  expect(parseHolidayDate("")).toBe(null);
  expect(parseHolidayDate(null)).toBe(null);
});
