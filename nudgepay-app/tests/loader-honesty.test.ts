import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeMessageMetrics,
  honestMetrics,
  inboxListCopy,
} from "../app/lib/message-inbox";
import { honestListState, honestPage } from "../app/lib/page-all";

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
