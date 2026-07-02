import { test, expect } from "vitest";
import { displayLabel, initialsFrom } from "../app/lib/names";

// ---------------------------------------------------------------------------
// displayLabel
// ---------------------------------------------------------------------------

test("displayLabel prefers display name when present", () => {
  expect(displayLabel("Jane Smith", "jane@acme.com", "abc-123")).toBe("Jane Smith");
});

test("displayLabel falls back to email local-part", () => {
  expect(displayLabel(null, "jane@acme.com", "abc-123")).toBe("jane");
  expect(displayLabel(undefined, "jane@acme.com", "abc-123")).toBe("jane");
  expect(displayLabel("", "jane@acme.com", "abc-123")).toBe("jane");
  expect(displayLabel("  ", "jane@acme.com", "abc-123")).toBe("jane");
});

test("displayLabel falls back to userId prefix", () => {
  expect(displayLabel(null, null, "abcdef12-3456")).toBe("abcdef12");
  expect(displayLabel(null, undefined, "abcdef12-3456")).toBe("abcdef12");
});

test("displayLabel trims whitespace from display name", () => {
  expect(displayLabel("  Jane Smith  ", "j@x.com", "abc")).toBe("Jane Smith");
});

// ---------------------------------------------------------------------------
// initialsFrom
// ---------------------------------------------------------------------------

test("initialsFrom extracts first two initials", () => {
  expect(initialsFrom("Jane Smith")).toBe("JS");
  expect(initialsFrom("John")).toBe("J");
  expect(initialsFrom("alice bob charlie")).toBe("AB");
});

test("initialsFrom handles dot/dash/underscore separators", () => {
  expect(initialsFrom("jane.smith")).toBe("JS");
  expect(initialsFrom("jane-smith")).toBe("JS");
  expect(initialsFrom("jane_smith")).toBe("JS");
});

test("initialsFrom returns ? for empty string", () => {
  expect(initialsFrom("")).toBe("?");
});

test("initialsFrom uppercases", () => {
  expect(initialsFrom("jane")).toBe("J");
  expect(initialsFrom("jane smith")).toBe("JS");
});
