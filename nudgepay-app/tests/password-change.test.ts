import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  passwordChangeDecision,
  passwordChangeVerifyFlash,
} from "../app/lib/password-change";

const VALID = {
  currentPassword: "old-pass-123",
  newPassword: "new-pass-123",
  confirmPassword: "new-pass-123",
};

describe("passwordChangeDecision", () => {
  it("accepts a new password of at least 8 characters that matches confirm and differs from current", () => {
    expect(passwordChangeDecision(VALID)).toEqual({
      ok: true,
      currentPassword: "old-pass-123",
      newPassword: "new-pass-123",
    });
  });

  it("accepts a new password exactly MIN_PASSWORD_LENGTH long", () => {
    const eight = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(passwordChangeDecision({
      currentPassword: "old-pass-123",
      newPassword: eight,
      confirmPassword: eight,
    })).toEqual({ ok: true, currentPassword: "old-pass-123", newPassword: eight });
  });

  it("rejects a new password shorter than 8 characters", () => {
    const seven = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(passwordChangeDecision({
      currentPassword: "old-pass-123",
      newPassword: seven,
      confirmPassword: seven,
    })).toEqual({ ok: false, error: "password" });
    expect(passwordChangeDecision({
      ...VALID,
      newPassword: "",
      confirmPassword: "",
    })).toEqual({ ok: false, error: "password" });
  });

  it("rejects a confirm mismatch and does not treat it as ok", () => {
    expect(passwordChangeDecision({
      ...VALID,
      confirmPassword: "other-pass-123",
    })).toEqual({ ok: false, error: "password" });
  });

  it("rejects a new password that is the same as current", () => {
    expect(passwordChangeDecision({
      currentPassword: "same-pass-123",
      newPassword: "same-pass-123",
      confirmPassword: "same-pass-123",
    })).toEqual({ ok: false, error: "password" });
  });

  it("rejects a missing current password without calling it a match", () => {
    expect(passwordChangeDecision({
      ...VALID,
      currentPassword: "",
    })).toEqual({ ok: false, error: "password" });
    expect(passwordChangeDecision({
      ...VALID,
      currentPassword: null,
    })).toEqual({ ok: false, error: "password" });
    expect(passwordChangeDecision({
      ...VALID,
      currentPassword: undefined,
    })).toEqual({ ok: false, error: "password" });
  });

  it("rejects non-string fields", () => {
    expect(passwordChangeDecision({
      currentPassword: 123 as unknown,
      newPassword: VALID.newPassword,
      confirmPassword: VALID.confirmPassword,
    })).toEqual({ ok: false, error: "password" });
    expect(passwordChangeDecision({
      currentPassword: VALID.currentPassword,
      newPassword: ["secret"] as unknown,
      confirmPassword: VALID.confirmPassword,
    })).toEqual({ ok: false, error: "password" });
  });

  it("does not trim passwords — leading/trailing spaces are significant", () => {
    expect(passwordChangeDecision({
      currentPassword: "old-pass-123",
      newPassword: " newpass1",
      confirmPassword: " newpass1",
    })).toEqual({
      ok: true,
      currentPassword: "old-pass-123",
      newPassword: " newpass1",
    });
    expect(passwordChangeDecision({
      currentPassword: "old-pass-123",
      newPassword: "newpass1 ",
      confirmPassword: "newpass1",
    })).toEqual({ ok: false, error: "password" });
  });
});

describe("passwordChangeVerifyFlash", () => {
  it("maps invalid login credentials to wrong-password", () => {
    expect(passwordChangeVerifyFlash("Invalid login credentials")).toBe("wrong-password");
  });

  it("maps any other GoTrue message to the generic password flag", () => {
    expect(passwordChangeVerifyFlash("Email not confirmed")).toBe("password");
    expect(passwordChangeVerifyFlash("Some obscure Supabase error")).toBe("password");
    expect(passwordChangeVerifyFlash("")).toBe("password");
  });
});
