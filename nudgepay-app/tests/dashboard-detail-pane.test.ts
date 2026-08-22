import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detailPaneClass,
  isMobileCaseOpen,
  queuePaneClass,
} from "../app/lib/dashboard-panes";

const dashboard = readFileSync(new URL("../app/routes/dashboard.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/components/DetailPanel.tsx", import.meta.url), "utf8");
const workQueue = readFileSync(new URL("../app/components/WorkQueue.tsx", import.meta.url), "utf8");

function unprefixedWidth(src: string, token: string): boolean {
  return new RegExp(`(?:^|[\\s"'\\\`])${token}(?:$|[\\s"'\\\`])`).test(src);
}

describe("dashboard pane class contract (NP-AUD-2026-110)", () => {
  it("hides the queue below md only when a case is open", () => {
    expect(isMobileCaseOpen(null)).toBe(false);
    expect(isMobileCaseOpen(undefined)).toBe(false);
    expect(isMobileCaseOpen({ caseId: "c1" })).toBe(true);

    const closed = queuePaneClass(false);
    expect(closed).toContain("flex");
    expect(closed.split(/\s+/)).not.toContain("hidden");
    expect(closed).toContain("flex-1");

    const open = queuePaneClass(true);
    expect(open).toContain("hidden md:flex");
    expect(open).toContain("flex-col");
    expect(open).toContain("min-w-0");
  });

  it("sizes detail full-width below md and two-pane at md+", () => {
    const cls = detailPaneClass();
    expect(cls).toContain("flex-1");
    expect(cls).toContain("md:w-[28rem]");
    expect(cls).toContain("lg:w-[36rem]");
    expect(cls).toContain("xl:w-[48rem]");
    expect(cls).toContain("md:flex-none");
    expect(cls).toContain("min-w-0");
    expect(cls).not.toContain("md:w-96");
    expect(unprefixedWidth(cls, "w-96")).toBe(false);
    expect(unprefixedWidth(cls, "shrink-0")).toBe(false);
  });

  it("does not hide the queue when no case is selected (negative)", () => {
    expect(queuePaneClass(isMobileCaseOpen(null))).toBe(queuePaneClass(false));
    expect(queuePaneClass(false).startsWith("flex ")).toBe(true);
  });
});

describe("dashboard wiring (NP-AUD-2026-110)", () => {
  it("uses the pane helpers instead of a fixed w-96 shrink-0 sibling", () => {
    expect(dashboard).toContain("queuePaneClass(isMobileCaseOpen(selected))");
    expect(dashboard).toContain("detailPaneClass()");
    expect(dashboard).not.toMatch(/className="w-96 xl:w-\[28rem\] shrink-0/);
    expect(unprefixedWidth(dashboard, "w-96")).toBe(false);
  });

  it("keeps WorkQueue mounted (keyboard, bulk, coming-due) and Focus in the header", () => {
    expect(dashboard).toContain("<WorkQueue");
    expect(dashboard).toContain('to="/focus"');
    expect(dashboard).toContain("Focus mode");
    expect(workQueue).toContain("useQueueKeys({ enabled: true");
    expect(workQueue).toContain("<BulkActionBar");
    expect(workQueue).toContain("<ComingDueList");
  });

  it("clears `case` from the query string on Back and Close", () => {
    expect(detail).toContain("Back to queue");
    expect(detail).toContain('aria-label="Close detail panel"');
    expect(detail).toMatch(/md:hidden px-4 pt-3 pb-1/);
    expect(detail).toContain("hidden md:flex items-center justify-center w-6 h-6");
    expect(detail).toContain("dashboardHref");
    expect(detail).toContain("dashboardSearchParams");
    const closeHref = /dashboardHref\(\{\s*view,\s*sort,\s*q:\s*q \|\| undefined,\s*entity,\s*density\s*\}\)/g;
    expect(detail.match(closeHref)?.length).toBeGreaterThanOrEqual(2);
    expect(detail).not.toMatch(/new URLSearchParams\(\{\s*view,\s*sort,\s*\.\.\.\(q \? \{ q \} : \{\}\)\s*\}\)/);
    expect(detail).not.toMatch(/lg:hidden px-4 pt-3 pb-1/);
  });

  it("opens the account record and does not embed AccountProfile", () => {
    expect(detail).toContain("Open account record");
    expect(detail).toContain("`/accounts/${selected.customerId}`");
    expect(detail).not.toContain("AccountProfile");
    expect(dashboard).not.toContain("AccountProfile");
  });

  it("merges overdue ∪ coming-due invoices and aliases tab=activity to overview #history", () => {
    expect(dashboard).toContain("mergeWorkspaceInvoices");
    expect(dashboard).toContain("workspaceInvoices");
    expect(dashboard).toMatch(/searchParams\.get\("tab"\) === "activity"/);
    expect(dashboard).toContain('#history');
    expect(detail).toContain('id="history"');
    expect(detail).toContain("chaseRecipientsFrom");
    expect(detail).not.toContain('id: "activity" as const');
  });

  it("expands history via a React Router hash Link, not a raw fragment click", () => {
    expect(detail).toContain('hash: "#history"');
    expect(detail).toContain("location.search");
    expect(detail).not.toMatch(/<a\s+href="#history"/);
    expect(detail).toContain("previewWorkspaceInvoices");
  });
});
