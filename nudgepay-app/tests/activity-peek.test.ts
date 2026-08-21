import { expect, test } from "vitest";
import {
  clipSummary,
  collapsePeeks,
  summarizePeek,
  PEEK_MAX,
  PEEK_SUMMARY_MAX,
  PEEK_WINDOW_DAYS,
  type ActivityPeek,
} from "../app/lib/activity-peek";
import {
  loadPeekSource,
  loadReplySource,
  peekWindowStartIso,
} from "../app/lib/activity-peek.server";
import { buildCaseItems } from "../app/lib/cases";
import { DEFAULT_ORG_CONFIG } from "../app/lib/org-config";

test("PEEK_MAX is three and summaries clip at 80", () => {
  expect(PEEK_MAX).toBe(3);
  expect(PEEK_SUMMARY_MAX).toBe(80);
  expect(PEEK_WINDOW_DAYS).toBe(90);
});

test("clipSummary collapses whitespace and ellipsizes over the max", () => {
  expect(clipSummary("  hello   world  ")).toBe("hello world");
  const exact = "x".repeat(PEEK_SUMMARY_MAX);
  expect(clipSummary(exact)).toBe(exact);
  const long = "x".repeat(PEEK_SUMMARY_MAX + 10);
  const clipped = clipSummary(long);
  expect(clipped.endsWith("…")).toBe(true);
  expect(clipped.length).toBe(PEEK_SUMMARY_MAX);
});

test("summarizePeek maps inbound to reply using body, subject, or fallback", () => {
  expect(summarizePeek({ direction: "inbound", body: "I'll pay Friday" })).toEqual({
    kind: "reply",
    summary: "I'll pay Friday",
  });
  expect(summarizePeek({ direction: "inbound", subject: "Re: invoice" })).toEqual({
    kind: "reply",
    summary: "Re: invoice",
  });
  expect(summarizePeek({ direction: "inbound" })).toEqual({
    kind: "reply",
    summary: "Customer replied",
  });
});

test("summarizePeek maps method note even when a direction is missing", () => {
  expect(summarizePeek({ method: "note", notes: "Left a voicemail later" })).toEqual({
    kind: "note",
    summary: "Left a voicemail later",
  });
  expect(summarizePeek({ method: "note" })).toEqual({ kind: "note", summary: "Note" });
});

test("summarizePeek uses call/email/text from method and outcome labels", () => {
  expect(summarizePeek({ method: "call", outcome: "left-voicemail" })).toEqual({
    kind: "call",
    summary: "Left voicemail",
  });
  expect(summarizePeek({ method: "email", notes: "Sent statement" })).toEqual({
    kind: "email",
    summary: "Sent statement",
  });
  expect(summarizePeek({ method: "text", body: "Reminder" })).toEqual({
    kind: "text",
    summary: "Reminder",
  });
});

test("summarizePeek infers outbound email vs text and falls back to note", () => {
  expect(summarizePeek({ direction: "outbound", subject: "Invoice 1001" })).toEqual({
    kind: "email",
    summary: "Invoice 1001",
  });
  expect(summarizePeek({ direction: "outbound", body: "Hi" })).toEqual({
    kind: "text",
    summary: "Hi",
  });
  expect(summarizePeek({})).toEqual({ kind: "note", summary: "Logged" });
});

test("collapsePeeks sorts newest first, dedupes, and caps at three", () => {
  const entries: ActivityPeek[] = [
    { at: "2026-06-01T10:00:00Z", kind: "note", summary: "A" },
    { at: "2026-06-03T10:00:00Z", kind: "call", summary: "C" },
    { at: "2026-06-02T10:00:00Z", kind: "text", summary: "B" },
    { at: "2026-06-03T10:00:00Z", kind: "call", summary: "C" },
    { at: "2026-06-04T10:00:00Z", kind: "reply", summary: "D" },
  ];
  expect(collapsePeeks(entries)).toEqual([
    { at: "2026-06-04T10:00:00Z", kind: "reply", summary: "D" },
    { at: "2026-06-03T10:00:00Z", kind: "call", summary: "C" },
    { at: "2026-06-02T10:00:00Z", kind: "text", summary: "B" },
  ]);
});

test("peekWindowStartIso is 90 days before the org-local today", () => {
  expect(peekWindowStartIso("2026-06-22")).toBe("2026-03-24T00:00:00.000Z");
});

type TableRows = { rows: Record<string, unknown>[]; count?: number };

function makeClient(tables: Record<string, TableRows>) {
  const calls: { table: string; select: string; inCol: string; ids: string[] }[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = { select: "", inCol: "", ids: [] as string[], from: 0, to: Number.POSITIVE_INFINITY };
      const q: Record<string, unknown> = {
        select(cols: string) {
          state.select = cols;
          return q;
        },
        eq() {
          return q;
        },
        in(col: string, ids: string[]) {
          state.inCol = col;
          state.ids = ids;
          return q;
        },
        gte() {
          return q;
        },
        order() {
          return q;
        },
        range(from: number, to: number) {
          state.from = from;
          state.to = to;
          return q;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const idSet = new Set(state.ids);
          const filtered = src.rows.filter((r) => {
            const key = state.inCol === "customer_id" ? r.customer_id : r.case_id;
            return typeof key === "string" && idSet.has(key);
          });
          calls.push({ table, select: state.select, inCol: state.inCol, ids: state.ids });
          return Promise.resolve({
            data: filtered.slice(state.from, state.to + 1),
            count: src.count ?? filtered.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as any, calls };
}

test("loadPeekSource returns empty peeks for no case ids", async () => {
  const { client, calls } = makeClient({});
  const result = await loadPeekSource({
    supabase: client,
    orgId: "org-1",
    caseIds: [],
    windowStartIso: "2026-03-24T00:00:00.000Z",
  });
  expect(result.truncated).toBe(false);
  expect(result.peeksByCase.size).toBe(0);
  expect(calls).toEqual([]);
});

test("loadPeekSource is case-scoped, includes bodies, and collapses per case", async () => {
  const { client, calls } = makeClient({
    contact_logs: {
      rows: [
        { case_id: "c1", method: "call", outcome: "left-voicemail", notes: null, created_at: "2026-06-20T10:00:00Z" },
        { case_id: "c1", method: "note", outcome: null, notes: "AP out this week", created_at: "2026-06-19T10:00:00Z" },
        { case_id: "c2", method: "call", outcome: "no-answer", notes: null, created_at: "2026-06-18T10:00:00Z" },
      ],
    },
    text_messages: {
      rows: [
        { case_id: "c1", direction: "inbound", body: "Paying Friday", created_at: "2026-06-21T10:00:00Z" },
      ],
    },
    email_messages: {
      rows: [
        { case_id: "c1", direction: "outbound", subject: "Invoice 1001", created_at: "2026-06-17T10:00:00Z" },
      ],
    },
  });
  const result = await loadPeekSource({
    supabase: client,
    orgId: "org-1",
    caseIds: ["c1", "c2"],
    windowStartIso: "2026-03-24T00:00:00.000Z",
  });
  expect(result.truncated).toBe(false);
  expect(result.peeksByCase.get("c1")).toEqual([
    { at: "2026-06-21T10:00:00Z", kind: "reply", summary: "Paying Friday" },
    { at: "2026-06-20T10:00:00Z", kind: "call", summary: "Left voicemail" },
    { at: "2026-06-19T10:00:00Z", kind: "note", summary: "AP out this week" },
  ]);
  expect(result.peeksByCase.get("c2")).toEqual([
    { at: "2026-06-18T10:00:00Z", kind: "call", summary: "No answer" },
  ]);
  expect(result.peeksByCase.has("c-missing")).toBe(false);
  expect(calls.find((c) => c.table === "contact_logs")?.select).toContain("notes");
  expect(calls.find((c) => c.table === "text_messages")?.select).toContain("body");
  expect(calls.find((c) => c.table === "email_messages")?.select).toContain("subject");
  expect(calls.every((c) => c.inCol === "case_id")).toBe(true);
});

test("loadPeekSource returns empty peeks when any source is truncated", async () => {
  const { client } = makeClient({
    contact_logs: {
      rows: [{ case_id: "c1", method: "call", outcome: "no-answer", notes: null, created_at: "2026-06-20T10:00:00Z" }],
    },
    text_messages: {
      rows: [{ case_id: "c1", direction: "inbound", body: "Hi", created_at: "2026-06-21T10:00:00Z" }],
      count: 6000,
    },
    email_messages: { rows: [] },
  });
  const result = await loadPeekSource({
    supabase: client,
    orgId: "org-1",
    caseIds: ["c1"],
    windowStartIso: "2026-03-24T00:00:00.000Z",
  });
  expect(result.truncated).toBe(true);
  expect(result.peeksByCase.size).toBe(0);
});

test("loadReplySource is customer-scoped, skips nulls, and has no bodies", async () => {
  const { client, calls } = makeClient({
    text_messages: {
      rows: [
        { customer_id: "cust-1", direction: "outbound" },
        { customer_id: "cust-1", direction: "inbound" },
        { customer_id: null, direction: "inbound" },
      ],
    },
    email_messages: {
      rows: [
        { customer_id: "cust-1", direction: "outbound" },
        { customer_id: "cust-2", direction: "inbound" },
      ],
    },
  });
  const result = await loadReplySource({
    supabase: client,
    orgId: "org-1",
    customerIds: ["cust-1", "cust-2", ""],
    windowStartIso: "2026-03-24T00:00:00.000Z",
  });
  expect(result.truncated).toBe(false);
  expect(result.replyByCustomer.get("cust-1")).toEqual({ inbound: 1, outbound: 2 });
  expect(result.replyByCustomer.get("cust-2")).toEqual({ inbound: 1, outbound: 0 });
  expect(calls.every((c) => c.inCol === "customer_id")).toBe(true);
  expect(calls.find((c) => c.table === "text_messages")?.select).toBe("customer_id, direction");
  expect(calls.find((c) => c.table === "email_messages")?.select).toBe("customer_id, direction");
});

test("loadReplySource flags truncation and never invents a 0% from empty outbound", async () => {
  const { client } = makeClient({
    text_messages: {
      rows: [{ customer_id: "cust-1", direction: "inbound" }],
      count: 6000,
    },
    email_messages: { rows: [] },
  });
  const result = await loadReplySource({
    supabase: client,
    orgId: "org-1",
    customerIds: ["cust-1", "cust-missing"],
    windowStartIso: "2026-03-24T00:00:00.000Z",
  });
  expect(result.truncated).toBe(true);
  const seen = result.replyByCustomer.get("cust-1");
  expect(seen?.outbound ?? 0).toBe(0);
  expect(result.replyByCustomer.has("cust-missing")).toBe(false);
});

test("mapper attaches peeks after buildCaseItems and defaults payer to null", () => {
  const cases = [{
    id: "case-1", customerId: "c1", status: "working" as const, nextActionType: "contact" as const,
    nextActionAt: null, exceptionReason: null, exceptionNote: null,
  }];
  const invoices = [{ id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 100, due_date: "2026-03-01" }];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: null }];
  const base = buildCaseItems(cases, invoices, customers, [], [], "2026-06-22", new Map(), DEFAULT_ORG_CONFIG);
  expect(base[0].peeks).toEqual([]);
  expect(base[0].payer).toBeNull();
  const peeksByCase = new Map<string, ActivityPeek[]>([
    ["case-1", [{ at: "2026-06-21T10:00:00Z", kind: "reply", summary: "Paying Friday" }]],
  ]);
  const payerByCustomer = new Map<string, null>();
  const items = base.map((i) => ({
    ...i,
    peeks: peeksByCase.get(i.caseId) ?? [],
    payer: payerByCustomer.get(i.customerId) ?? null,
  }));
  expect(items[0].peeks).toEqual([
    { at: "2026-06-21T10:00:00Z", kind: "reply", summary: "Paying Friday" },
  ]);
  expect(items[0].payer).toBeNull();
});
