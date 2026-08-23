import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeMessageMetrics,
  honestMetrics,
  inboxListCopy,
} from "../app/lib/message-inbox";
import { honestListState, honestPage } from "../app/lib/page-all";
import {
  applyCaseView, buildCaseItems, computeCaseMetrics, queueTruncationMessage,
} from "../app/lib/cases";
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";
import { whyNow } from "../app/lib/next-best-action";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("length < count must not yield empty-inbox-as-done or numeric 0 metrics", () => {
  const short = honestPage({ data: [], count: 1001, error: null, askedExact: true });
  expect(short.truncated).toBe(true);
  expect(short.error).toBeNull();
  const metrics = computeMessageMetrics([]);
  expect(metrics.needsReply).toBe(0);
  expect(honestMetrics(metrics, { loadError: null, truncated: true })).toBeNull();
  expect(inboxListCopy({ loadError: null, truncated: true, rowCount: 0 }))
    .toBe("Inbox may be incomplete.");
  expect(inboxListCopy({ loadError: null, truncated: true, rowCount: 0 }))
    .not.toBe("No threads in this view.");
});

test("query error must not coerce to [] complete or empty-inbox-as-done", () => {
  const failed = honestPage({
    data: [{ id: "x" }], count: 1, error: { message: "boom" }, askedExact: true,
  });
  expect(failed.rows).toEqual([]);
  expect(failed.truncated).toBe(false);
  expect(failed.error).toEqual({ message: "boom" });
  const state = honestListState([failed, { error: null, truncated: true }]);
  expect(state.loadError).toBe("boom");
  expect(state.truncated).toBe(false);
  expect(honestMetrics(computeMessageMetrics([]), {
    loadError: "Could not load inbox", truncated: false,
  })).toBeNull();
  expect(inboxListCopy({
    loadError: "Could not load inbox", truncated: false, rowCount: 0,
  })).toBe("Could not load inbox");
  expect(inboxListCopy({
    loadError: "Could not load inbox", truncated: false, rowCount: 0,
  })).not.toBe("No threads in this view.");
});

test("genuine empty inbox still says no threads", () => {
  expect(inboxListCopy({ loadError: null, truncated: false, rowCount: 0 }))
    .toBe("No threads in this view.");
  expect(honestMetrics(computeMessageMetrics([]), {
    loadError: null, truncated: false,
  })).toEqual({ needsReply: 0, needsAttention: 0, active: 0, unanswered: 0 });
});

test("leftover list loaders never throw pageAll errors and set loadError", () => {
  const files = [
    "../app/routes/messages.tsx",
    "../app/routes/promises.tsx",
    "../app/routes/accounts.tsx",
    "../app/lib/reports.server.ts",
    "../app/lib/case-queue.server.ts",
    "../app/routes/dashboard.tsx",
    "../app/routes/focus.tsx",
  ];
  for (const rel of files) {
    const src = read(rel);
    expect(src, rel).toContain("honestListState");
    expect(src, rel).toMatch(/loadError/);
    expect(src, rel).not.toMatch(/pageAll<\w+>[\s\S]{0,40}throw /);
  }
});

test("Stage-1 pages overdue, coming-due, and open cases instead of throwing", () => {
  const src = read("../app/lib/case-queue.server.ts");
  expect(src).toContain('.lt("due_date", today)');
  expect(src).toContain('.gte("due_date", today)');
  expect(src).toContain("pageAll<CaseRowRaw>");
  expect(src).toContain("queueTruncated");
  expect(src).not.toMatch(/throw new Error\("invoices truncated/);
  expect(src).not.toMatch(/throw new Error\("cases truncated/);
  expect(src).toContain("pageAllChunkedHonest");
});

test("dashboard Batch C SMS and email queries use created_at desc via orderPage", () => {
  const src = read("../app/routes/dashboard.tsx");
  const batchC = src.slice(src.indexOf("pageAllHonest<MsgRow>"), src.indexOf("if (custErr)"));
  expect(batchC).toContain('from("text_messages")');
  expect(batchC).toContain('from("email_messages")');
  expect(batchC.match(/orderPage/g)?.length).toBeGreaterThanOrEqual(2);
  expect(batchC).toContain("pageAllHonest<EmailRow>");
  expect(batchC).not.toMatch(/order\("created_at", \{\s*ascending:\s*true/);
});

test("messages empty copy distinguishes loadError from no threads", () => {
  const route = read("../app/routes/messages.tsx");
  expect(route).toContain('"Could not load inbox"');
  expect(route).toContain("LoadErrorBanner");
  const inbox = read("../app/components/MessagesInbox.tsx");
  expect(inbox).toContain("inboxListCopy");
});

test("Stage-2 incomplete last-contact does not classify every case as never-contacted", () => {
  const cases = [{
    id: "case-1", customerId: "c1", status: "working" as const,
    nextActionType: "contact" as const, nextActionAt: null,
    exceptionReason: null, exceptionNote: null,
  }];
  const invoices = [{
    id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100,
    due_date: "2026-03-01", amount: 100, invoice_date: "2026-02-01", status: "overdue", paid_date: null,
  }];
  const customers = [{
    id: "c1", name: "Acme", phone: null, email: null, owner: null,
  }];
  const incomplete = buildCaseItems(
    cases, invoices, customers, [], [], "2026-06-22", new Map(), DEFAULT_ORG_CONFIG,
    { lastContactIncomplete: true },
  );
  expect(incomplete[0].lastContact).toBeNull();
  expect(incomplete[0].lastContactUnknown).toBe(true);
  expect(applyCaseView(incomplete, "never-contacted", "2026-06-22", null)).toEqual([]);
  expect(computeCaseMetrics(incomplete, "2026-06-22").neverContacted.count).toBe(0);
  expect(incomplete[0].factors.some((f) => f.key === "silence")).toBe(false);
  expect(whyNow(incomplete[0]).reason).toContain("Contact history unknown");
  expect(whyNow(incomplete[0]).reason).not.toContain("Never contacted");

  const knownEmpty = buildCaseItems(
    cases, invoices, customers, [], [], "2026-06-22", new Map(), DEFAULT_ORG_CONFIG,
  );
  expect(knownEmpty[0].lastContactUnknown).toBe(false);
  expect(applyCaseView(knownEmpty, "never-contacted", "2026-06-22", null)).toHaveLength(1);
});

test("queue truncation banner names the truncated Stage-1 page", () => {
  expect(queueTruncationMessage({
    overdue: false, comingDue: true, cases: false, customers: false,
  })).toBe("Showing a partial coming-due invoices list — list may be incomplete");
  expect(queueTruncationMessage({
    overdue: true, comingDue: false, cases: true, customers: false,
  })).toBe("Showing a partial overdue invoices / open cases list — list may be incomplete");
  expect(queueTruncationMessage({
    overdue: false, comingDue: false, cases: false, customers: false,
  })).toBeNull();
});

test("team and AR CSV 503 on loadError; 409 only when truncated", () => {
  const csv = read("../app/routes/reports.csv.tsx");
  const arBranch = csv.slice(csv.indexOf('sheet === "ar"'), csv.indexOf("} else {"));
  const teamBranch = csv.slice(csv.indexOf("} else {"));
  expect(arBranch).toContain("arKpis.loadError");
  expect(arBranch).toContain("status: 503");
  expect(arBranch.indexOf("loadError")).toBeLessThan(arBranch.indexOf("truncated"));
  expect(teamBranch).toContain("report.loadError");
  expect(teamBranch).toContain("status: 503");
  expect(teamBranch.indexOf("loadError")).toBeLessThan(teamBranch.indexOf("truncated"));
});

test("queue.csv fails closed on lastContactLoadError and truncation", () => {
  const src = read("../app/routes/queue.csv.tsx");
  expect(src).toContain("lastContactLoadError");
  expect(src).toContain("status: 503");
  expect(src).toContain("queueTruncated");
  expect(src).toContain("status: 409");
});

test("dashboard AR contactRate is truncated when Stage-1 cases are truncated", () => {
  const src = read("../app/routes/dashboard.tsx");
  expect(src).toContain("queueTruncation.cases");
  expect(src).toContain("lastContactLoadError");
});

