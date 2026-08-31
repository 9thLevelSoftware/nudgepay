import { describe, expect, it } from "vitest";
import {
  PERSONAL_DELETE_TOKEN,
  personalAccountConfirmMatches,
  personalAccountDeletionDecision,
} from "../app/lib/personal-account-deletion";

const EMAIL = "owner@example.com";

describe("personalAccountConfirmMatches", () => {
  it("matches the current email, trimmed and case-insensitive", () => {
    expect(personalAccountConfirmMatches("owner@example.com", EMAIL)).toBe(true);
    expect(personalAccountConfirmMatches("  OWNER@Example.COM  ", EMAIL)).toBe(true);
  });

  it("matches the DELETE token exactly after trim", () => {
    expect(personalAccountConfirmMatches(PERSONAL_DELETE_TOKEN, EMAIL)).toBe(true);
    expect(personalAccountConfirmMatches("  DELETE  ", EMAIL)).toBe(true);
  });

  it("rejects LEAVE and other tokens", () => {
    expect(personalAccountConfirmMatches("LEAVE", EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches("leave", EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches("delete", EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches("", EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches("   ", EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches(null, EMAIL)).toBe(false);
    expect(personalAccountConfirmMatches("other@example.com", EMAIL)).toBe(false);
  });
});

describe("personalAccountDeletionDecision", () => {
  it("rejects a missing or wrong confirm token", () => {
    expect(personalAccountDeletionDecision({
      confirm: "",
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: false, error: "confirm" });
    expect(personalAccountDeletionDecision({
      confirm: "LEAVE",
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: false, error: "confirm" });
  });

  it("blocks last-owner erasure even with a valid confirm token", () => {
    expect(personalAccountDeletionDecision({
      confirm: PERSONAL_DELETE_TOKEN,
      currentEmail: EMAIL,
      isLastOwner: true,
    })).toEqual({ ok: false, error: "last-owner" });
    expect(personalAccountDeletionDecision({
      confirm: EMAIL,
      currentEmail: EMAIL,
      isLastOwner: true,
    })).toEqual({ ok: false, error: "last-owner" });
  });

  it("allows a non-last-owner with email or DELETE", () => {
    expect(personalAccountDeletionDecision({
      confirm: PERSONAL_DELETE_TOKEN,
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: true });
    expect(personalAccountDeletionDecision({
      confirm: EMAIL,
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: true });
  });
});
