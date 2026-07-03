import { expect, test } from "vitest";
import { parseOrgSettingsUpdate, parseHolidayDate, parseHolidayLabel, parsePriorityThresholdsUpdate, parseWorkflowKnobsUpdate } from "../app/lib/org-settings";

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

test("parseHolidayLabel trims, clamps to 80 chars, and normalizes blank to null", () => {
  expect(parseHolidayLabel("Independence Day")).toBe("Independence Day");
  expect(parseHolidayLabel("  Christmas  ")).toBe("Christmas");
  expect(parseHolidayLabel("")).toBe(null);
  expect(parseHolidayLabel("   ")).toBe(null);
  expect(parseHolidayLabel(null)).toBe(null);
  const long = "x".repeat(100);
  expect(parseHolidayLabel(long)).toBe("x".repeat(80));
});

// --- parsePriorityThresholdsUpdate (Phase 4) ---

const priorityFd = (entries: Array<[string, string]>): FormData => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

const validPriority: Array<[string, string]> = [
  ["high_value_threshold", "5000"],
  ["priority_critical_min", "80"],
  ["priority_high_min", "50"],
  ["priority_medium_min", "25"],
];

test("parsePriorityThresholdsUpdate accepts a valid form", () => {
  const r = parsePriorityThresholdsUpdate(priorityFd(validPriority));
  expect(r).toEqual({
    ok: true,
    patch: { high_value_threshold: 5000, priority_critical_min: 80, priority_high_min: 50, priority_medium_min: 25 },
  });
});

test("high_value_threshold of 0 or negative is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "high_value_threshold" ? [k, "0"] : [k, v]),
  ))).toEqual({ ok: false, error: "high_value_threshold" });
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "high_value_threshold" ? [k, "-100"] : [k, v]),
  ))).toEqual({ ok: false, error: "high_value_threshold" });
});

test("missing or non-numeric high_value_threshold is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.filter(([k]) => k !== "high_value_threshold"),
  ))).toEqual({ ok: false, error: "high_value_threshold" });
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "high_value_threshold" ? [k, "abc"] : [k, v]),
  ))).toEqual({ ok: false, error: "high_value_threshold" });
});

test("non-integer or missing level threshold is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.filter(([k]) => k !== "priority_high_min"),
  ))).toEqual({ ok: false, error: "priority_thresholds" });
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "priority_critical_min" ? [k, "80.5"] : [k, v]),
  ))).toEqual({ ok: false, error: "priority_thresholds" });
});

test("ordering violation: critical <= high is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "priority_critical_min" ? [k, "50"] : [k, v]), // 50 == high
  ))).toEqual({ ok: false, error: "priority_thresholds_order" });
});

test("ordering violation: high <= medium is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "priority_high_min" ? [k, "20"] : [k, v]), // 20 < medium (25)
  ))).toEqual({ ok: false, error: "priority_thresholds_order" });
});

test("ordering violation: medium <= 0 is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "priority_medium_min" ? [k, "0"] : [k, v]),
  ))).toEqual({ ok: false, error: "priority_thresholds_order" });
});

test("high_value_threshold below $1,000 floor is rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "high_value_threshold" ? [k, "999"] : [k, v]),
  ))).toEqual({ ok: false, error: "high_value_threshold" });
  // exactly $1,000 is accepted
  const r = parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "high_value_threshold" ? [k, "1000"] : [k, v]),
  ));
  expect(r.ok).toBe(true);
});

test("level thresholds above 200 are rejected", () => {
  expect(parsePriorityThresholdsUpdate(priorityFd(
    validPriority.map(([k, v]) => k === "priority_critical_min" ? [k, "201"] : [k, v]),
  ))).toEqual({ ok: false, error: "priority_thresholds_range" });
});

test("level thresholds with gap < 5 are rejected", () => {
  // critical=54, high=50, medium=25 — gap between critical and high is 4
  expect(parsePriorityThresholdsUpdate(priorityFd([
    ["high_value_threshold", "5000"],
    ["priority_critical_min", "54"],
    ["priority_high_min", "50"],
    ["priority_medium_min", "25"],
  ]))).toEqual({ ok: false, error: "priority_thresholds_range" });
  // critical=80, high=29, medium=25 — gap between high and medium is 4
  expect(parsePriorityThresholdsUpdate(priorityFd([
    ["high_value_threshold", "5000"],
    ["priority_critical_min", "80"],
    ["priority_high_min", "29"],
    ["priority_medium_min", "25"],
  ]))).toEqual({ ok: false, error: "priority_thresholds_range" });
});

// --- parseWorkflowKnobsUpdate (Phase 5) ---

const workflowFd = (entries: Array<[string, string]>): FormData => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

const validWorkflow: Array<[string, string]> = [
  ["coming_due_days", "7"],
  ["due_soon_business_days", "3"],
  ["sms_batch_limit", "50"],
];

test("parseWorkflowKnobsUpdate accepts a valid form", () => {
  const r = parseWorkflowKnobsUpdate(workflowFd(validWorkflow));
  expect(r).toEqual({
    ok: true,
    patch: { coming_due_days: 7, due_soon_business_days: 3, sms_batch_limit: 50 },
  });
});

test("parseWorkflowKnobsUpdate accepts the extreme ends of each range", () => {
  expect(parseWorkflowKnobsUpdate(workflowFd([
    ["coming_due_days", "1"], ["due_soon_business_days", "1"], ["sms_batch_limit", "1"],
  ]))).toMatchObject({ ok: true });
  expect(parseWorkflowKnobsUpdate(workflowFd([
    ["coming_due_days", "60"], ["due_soon_business_days", "30"], ["sms_batch_limit", "200"],
  ]))).toMatchObject({ ok: true });
});

test("coming_due_days outside 1-60 is rejected", () => {
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "coming_due_days" ? [k, "0"] : [k, v]),
  ))).toEqual({ ok: false, error: "coming_due_days" });
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "coming_due_days" ? [k, "61"] : [k, v]),
  ))).toEqual({ ok: false, error: "coming_due_days" });
});

test("due_soon_business_days outside 1-30 is rejected", () => {
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "due_soon_business_days" ? [k, "0"] : [k, v]),
  ))).toEqual({ ok: false, error: "due_soon_business_days" });
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "due_soon_business_days" ? [k, "31"] : [k, v]),
  ))).toEqual({ ok: false, error: "due_soon_business_days" });
});

test("sms_batch_limit outside 1-200 is rejected", () => {
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "sms_batch_limit" ? [k, "0"] : [k, v]),
  ))).toEqual({ ok: false, error: "sms_batch_limit" });
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "sms_batch_limit" ? [k, "201"] : [k, v]),
  ))).toEqual({ ok: false, error: "sms_batch_limit" });
});

test("non-integer or missing workflow knobs are rejected", () => {
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.filter(([k]) => k !== "coming_due_days"),
  ))).toEqual({ ok: false, error: "coming_due_days" });
  expect(parseWorkflowKnobsUpdate(workflowFd(
    validWorkflow.map(([k, v]) => k === "sms_batch_limit" ? [k, "50.5"] : [k, v]),
  ))).toEqual({ ok: false, error: "sms_batch_limit" });
});
