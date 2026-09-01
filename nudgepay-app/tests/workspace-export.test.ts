import { describe, expect, it } from "vitest";
import {
  buildWorkspaceDataExport,
  workspaceExportAllowed,
  workspaceExportFilename,
} from "../app/lib/workspace-export";

const emptyTable = { rows: [], truncated: false };

describe("workspaceExportAllowed", () => {
  it("is owner or admin", () => {
    expect(workspaceExportAllowed("owner")).toBe(true);
    expect(workspaceExportAllowed("admin")).toBe(true);
    expect(workspaceExportAllowed("member")).toBe(false);
    expect(workspaceExportAllowed("")).toBe(false);
  });
});

describe("buildWorkspaceDataExport", () => {
  it("passes through workspace rows and truncation", () => {
    const payload = buildWorkspaceDataExport({
      exportedAt: "2026-08-31T12:00:00.000Z",
      truncated: true,
      workspace: { id: "o1", name: "Acme" },
      memberships: { rows: [{ userId: "u1", role: "owner" }], truncated: false },
      customers: emptyTable,
      invoices: emptyTable,
      cases: emptyTable,
      promises: emptyTable,
      contactLogs: emptyTable,
      textMessages: emptyTable,
      emailMessages: emptyTable,
    });
    expect(payload.workspace.name).toBe("Acme");
    expect(payload.memberships.rows[0].role).toBe("owner");
    expect(payload.truncated).toBe(true);
  });
});

describe("workspaceExportFilename", () => {
  it("uses the UTC date from the export timestamp", () => {
    expect(workspaceExportFilename("2026-08-31T21:00:00.000Z")).toBe("nudgepay-workspace-2026-08-31.json");
  });
});
