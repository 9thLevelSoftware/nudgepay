import { expect, test } from "vitest";
import { resolveCallAction } from "../app/lib/channel-actions";
import { DEFAULT_COMM_PREFS } from "../app/lib/comm-prefs";

test("no phone → hidden", () => {
  expect(resolveCallAction(DEFAULT_COMM_PREFS, null)).toEqual({ kind: "hidden" });
  expect(resolveCallAction(DEFAULT_COMM_PREFS, "")).toEqual({ kind: "hidden" });
});

test("phone + do_not_call → blocked with reason", () => {
  const prefs = { ...DEFAULT_COMM_PREFS, doNotCall: true };
  expect(resolveCallAction(prefs, "555-0100")).toEqual({ kind: "blocked", reason: "Customer asked not to be called" });
});

test("phone + not opted out → live", () => {
  expect(resolveCallAction(DEFAULT_COMM_PREFS, "555-0100")).toEqual({ kind: "live" });
});
