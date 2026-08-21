import { describe, expect, it } from "vitest";
import {
  DELETE_CONFIRM_TOKEN,
  accountDeletionDecision,
  deletionConfirmMatches,
  isLastOwnerMember,
  shouldDisconnectQboOnAccountDelete,
} from "../app/lib/account-deletion";

const EMAIL = "owner@example.com";

describe("deletionConfirmMatches", () => {
  it("matches the current email, trimmed and case-insensitive", () => {
    expect(deletionConfirmMatches("owner@example.com", EMAIL)).toBe(true);
    expect(deletionConfirmMatches("  OWNER@Example.COM  ", EMAIL)).toBe(true);
  });

  it("matches the DELETE token exactly after trim", () => {
    expect(deletionConfirmMatches(DELETE_CONFIRM_TOKEN, EMAIL)).toBe(true);
    expect(deletionConfirmMatches("  DELETE  ", EMAIL)).toBe(true);
  });

  it("rejects a missing or wrong confirm token", () => {
    expect(deletionConfirmMatches("", EMAIL)).toBe(false);
    expect(deletionConfirmMatches("   ", EMAIL)).toBe(false);
    expect(deletionConfirmMatches(null, EMAIL)).toBe(false);
    expect(deletionConfirmMatches(undefined, EMAIL)).toBe(false);
    expect(deletionConfirmMatches("delete", EMAIL)).toBe(false);
    expect(deletionConfirmMatches("owner", EMAIL)).toBe(false);
    expect(deletionConfirmMatches("other@example.com", EMAIL)).toBe(false);
  });
});

describe("accountDeletionDecision", () => {
  it("rejects deletion without a confirm token", () => {
    expect(accountDeletionDecision({
      confirm: "",
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: false, error: "confirm" });
    expect(accountDeletionDecision({
      confirm: null,
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: false, error: "confirm" });
    expect(accountDeletionDecision({
      confirm: "nope",
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: false, error: "confirm" });
  });

  it("blocks last-owner deletion even with a valid confirm token", () => {
    expect(accountDeletionDecision({
      confirm: DELETE_CONFIRM_TOKEN,
      currentEmail: EMAIL,
      isLastOwner: true,
    })).toEqual({ ok: false, error: "last-owner" });
    expect(accountDeletionDecision({
      confirm: EMAIL,
      currentEmail: EMAIL,
      isLastOwner: true,
    })).toEqual({ ok: false, error: "last-owner" });
  });

  it("allows a non-last-owner with a valid confirm token", () => {
    expect(accountDeletionDecision({
      confirm: DELETE_CONFIRM_TOKEN,
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: true });
    expect(accountDeletionDecision({
      confirm: EMAIL,
      currentEmail: EMAIL,
      isLastOwner: false,
    })).toEqual({ ok: true });
  });
});

describe("isLastOwnerMember", () => {
  it("is true only for an owner when no other owner remains", () => {
    expect(isLastOwnerMember(true, 1)).toBe(true);
    expect(isLastOwnerMember(true, 0)).toBe(true);
    expect(isLastOwnerMember(true, 2)).toBe(false);
    expect(isLastOwnerMember(false, 1)).toBe(false);
    expect(isLastOwnerMember(false, 0)).toBe(false);
  });
});

describe("shouldDisconnectQboOnAccountDelete", () => {
  it("disconnects only when QBO is connected and no other members remain", () => {
    expect(shouldDisconnectQboOnAccountDelete(true, 0)).toBe(true);
    expect(shouldDisconnectQboOnAccountDelete(true, 1)).toBe(false);
    expect(shouldDisconnectQboOnAccountDelete(false, 0)).toBe(false);
    expect(shouldDisconnectQboOnAccountDelete(false, 2)).toBe(false);
  });
});
