import { describe, expect, it } from "vitest";
import {
  buildPersonalDataExport,
  personalExportFilename,
} from "../app/lib/personal-data-export";

describe("buildPersonalDataExport", () => {
  it("passes through account, memberships, prefs, and logs", () => {
    const payload = buildPersonalDataExport({
      exportedAt: "2026-08-31T12:00:00.000Z",
      truncated: false,
      account: {
        id: "u1",
        email: "owner@example.com",
        displayName: "Pat",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      memberships: [{ orgId: "o1", orgName: "Acme", role: "owner" }],
      notificationPrefs: [{ orgId: "o1", brokenPromiseEmail: true, dailyDigestEmail: false }],
      contactLogs: [
        { id: "l1", createdAt: "2026-08-01T00:00:00.000Z", method: "call", outcome: "no-answer" },
      ],
    });
    expect(payload.account.email).toBe("owner@example.com");
    expect(payload.memberships[0]?.orgName).toBe("Acme");
    expect(payload.notificationPrefs[0]?.dailyDigestEmail).toBe(false);
    expect(payload.contactLogs).toHaveLength(1);
    expect(payload.truncated).toBe(false);
  });

  it("allows a subject with no workspace", () => {
    const payload = buildPersonalDataExport({
      exportedAt: "2026-08-31T12:00:00.000Z",
      truncated: true,
      account: { id: "u1", email: "a@example.com", displayName: null, createdAt: null },
      memberships: [],
      notificationPrefs: [],
      contactLogs: [],
    });
    expect(payload.memberships).toEqual([]);
    expect(payload.notificationPrefs).toEqual([]);
    expect(payload.truncated).toBe(true);
  });
});

describe("personalExportFilename", () => {
  it("uses the UTC date from the export timestamp", () => {
    expect(personalExportFilename("2026-08-31T21:00:00.000Z")).toBe("nudgepay-account-2026-08-31.json");
  });
});
