import { describe, it, expect } from "vitest";
import {
  NEXT_ACTION_LABEL,
  nextActionLabel,
  EMAIL_FAILURE_LABEL,
  emailFailureLabel,
  isHardBounce,
} from "../app/lib/labels";

describe("nextActionLabel", () => {
  it("maps known next-action types to human copy", () => {
    expect(nextActionLabel("follow_up")).toBe("Follow up");
    expect(nextActionLabel("promise")).toBe("Promise to pay");
    expect(nextActionLabel("waiting")).toBe("Waiting on customer");
    expect(nextActionLabel("exception")).toBe("Needs attention");
    expect(nextActionLabel("contact")).toBe("Contact");
  });

  it("covers every key in NEXT_ACTION_LABEL", () => {
    for (const [key, label] of Object.entries(NEXT_ACTION_LABEL)) {
      expect(nextActionLabel(key)).toBe(label);
    }
  });

  it("falls back to humanized snake_case for an unknown value", () => {
    expect(nextActionLabel("some_new_state")).toBe("Some New State");
  });

  it("returns an em dash for null", () => {
    expect(nextActionLabel(null)).toBe("—");
  });
});

describe("emailFailureLabel", () => {
  it("maps canonical failure codes to human copy", () => {
    expect(emailFailureLabel("hard_bounce")).toBe(EMAIL_FAILURE_LABEL.hard_bounce);
    expect(emailFailureLabel("soft_bounce")).toBe(EMAIL_FAILURE_LABEL.soft_bounce);
    expect(emailFailureLabel("bounce")).toBe(EMAIL_FAILURE_LABEL.bounce);
    expect(emailFailureLabel("complaint")).toBe(EMAIL_FAILURE_LABEL.complaint);
    expect(emailFailureLabel("unknown")).toBe(EMAIL_FAILURE_LABEL.unknown);
  });

  it("maps the raw Resend bounce sub-types emitted by email-events.ts", () => {
    expect(emailFailureLabel("hard")).toBe(EMAIL_FAILURE_LABEL.hard_bounce);
    expect(emailFailureLabel("permanent")).toBe(EMAIL_FAILURE_LABEL.hard_bounce);
    expect(emailFailureLabel("soft")).toBe(EMAIL_FAILURE_LABEL.soft_bounce);
    expect(emailFailureLabel("transient")).toBe(EMAIL_FAILURE_LABEL.soft_bounce);
  });

  it("is case-insensitive", () => {
    expect(emailFailureLabel("HARD_BOUNCE")).toBe(EMAIL_FAILURE_LABEL.hard_bounce);
  });

  it("falls back to humanized snake_case for an unrecognized code", () => {
    expect(emailFailureLabel("mailbox_full")).toBe("Mailbox Full");
  });

  it("returns an empty string for null", () => {
    expect(emailFailureLabel(null)).toBe("");
  });
});

describe("isHardBounce", () => {
  it("recognizes canonical and raw hard-bounce codes", () => {
    expect(isHardBounce("hard_bounce")).toBe(true);
    expect(isHardBounce("hard")).toBe(true);
    expect(isHardBounce("permanent")).toBe(true);
  });

  it("rejects soft bounces, other codes, and null", () => {
    expect(isHardBounce("soft_bounce")).toBe(false);
    expect(isHardBounce("soft")).toBe(false);
    expect(isHardBounce("complaint")).toBe(false);
    expect(isHardBounce(null)).toBe(false);
  });
});
