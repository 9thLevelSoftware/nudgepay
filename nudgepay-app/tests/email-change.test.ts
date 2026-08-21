import { describe, expect, it } from "vitest";
import { emailChangeDecision } from "../app/lib/email-change";

describe("emailChangeDecision", () => {
  it("accepts a different well-formed email and normalizes it", () => {
    expect(emailChangeDecision("  New.User@Example.COM  ", "user@example.com")).toEqual({
      ok: true,
      noop: false,
      email: "new.user@example.com",
    });
  });

  it("rejects an invalid email", () => {
    expect(emailChangeDecision("not-an-email", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("missing-at.com", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("user@", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("@example.com", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("user@localhost", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision("   ", "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
  });

  it("rejects non-string fields", () => {
    expect(emailChangeDecision(null, "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision(undefined, "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
    expect(emailChangeDecision(123 as unknown, "user@example.com")).toEqual({
      ok: false,
      error: "email",
    });
  });

  it("treats the same email as a no-op (case-insensitive, trimmed)", () => {
    expect(emailChangeDecision("user@example.com", "user@example.com")).toEqual({
      ok: true,
      noop: true,
    });
    expect(emailChangeDecision("  USER@Example.COM  ", "user@example.com")).toEqual({
      ok: true,
      noop: true,
    });
  });
});
