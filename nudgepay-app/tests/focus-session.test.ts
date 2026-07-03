import { expect, test } from "vitest";
import {
  initFocusSession,
  focusSessionReducer,
  triageCount,
  isDone,
} from "../app/lib/focus-session";

test("initFocusSession creates a fresh session", () => {
  const s = initFocusSession(["a", "b", "c"]);
  expect(s.order).toEqual(["a", "b", "c"]);
  expect(s.index).toBe(0);
  expect(s.results).toEqual({});
  expect(s.actions).toBe(0);
  expect(triageCount(s)).toBe(0);
  expect(isDone(s)).toBe(false);
});

test("resolve advances index and increments actions", () => {
  let s = initFocusSession(["a", "b"]);
  s = focusSessionReducer(s, { type: "resolve", result: "logged" });
  expect(s.index).toBe(1);
  expect(s.results).toEqual({ a: "logged" });
  expect(s.actions).toBe(1);
  expect(triageCount(s)).toBe(1);
  expect(isDone(s)).toBe(false);
});

test("skip advances index but does not increment actions", () => {
  let s = initFocusSession(["a", "b"]);
  s = focusSessionReducer(s, { type: "skip" });
  expect(s.index).toBe(1);
  expect(s.results).toEqual({ a: "skipped" });
  expect(s.actions).toBe(0);
  expect(triageCount(s)).toBe(1);
});

test("done when all cases triaged", () => {
  let s = initFocusSession(["a"]);
  s = focusSessionReducer(s, { type: "resolve", result: "texted" });
  expect(isDone(s)).toBe(true);
  expect(triageCount(s)).toBe(1);
  expect(s.actions).toBe(1);
});

test("resolve at done is a no-op", () => {
  let s = initFocusSession(["a"]);
  s = focusSessionReducer(s, { type: "resolve", result: "snoozed" });
  const s2 = focusSessionReducer(s, { type: "resolve", result: "logged" });
  expect(s2).toBe(s); // same reference
});

test("skip at done is a no-op", () => {
  let s = initFocusSession(["a"]);
  s = focusSessionReducer(s, { type: "skip" });
  const s2 = focusSessionReducer(s, { type: "skip" });
  expect(s2).toBe(s);
});

test("restart resets the session with a new order", () => {
  let s = initFocusSession(["a", "b"]);
  s = focusSessionReducer(s, { type: "resolve", result: "logged" });
  s = focusSessionReducer(s, { type: "restart", order: ["x", "y", "z"] });
  expect(s.order).toEqual(["x", "y", "z"]);
  expect(s.index).toBe(0);
  expect(s.results).toEqual({});
  expect(s.actions).toBe(0);
  expect(isDone(s)).toBe(false);
});

test("mixed sequence: resolve + skip + resolve → correct counts", () => {
  let s = initFocusSession(["a", "b", "c"]);
  s = focusSessionReducer(s, { type: "resolve", result: "logged" });
  s = focusSessionReducer(s, { type: "skip" });
  s = focusSessionReducer(s, { type: "resolve", result: "snoozed" });
  expect(triageCount(s)).toBe(3);
  expect(s.actions).toBe(2); // skip excluded
  expect(isDone(s)).toBe(true);
  expect(s.results).toEqual({ a: "logged", b: "skipped", c: "snoozed" });
});

test("empty order → immediately done", () => {
  const s = initFocusSession([]);
  expect(isDone(s)).toBe(true);
  expect(triageCount(s)).toBe(0);
});
