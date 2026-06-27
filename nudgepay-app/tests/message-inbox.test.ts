import { expect, test } from "vitest";
import {
  buildThreadRows, applyMessageTab, sortThreadRows, computeMessageMetrics,
  MESSAGE_TABS, MESSAGE_SORTS,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../app/lib/message-inbox";
import { DEFAULT_COMM_PREFS } from "../app/lib/comm-prefs";

const prefs = (over = {}) => ({ ...DEFAULT_COMM_PREFS, ...over });

// c1 latest=inbound → needsReply; c2 latest=outbound failed → needsAttention;
// c3 latest=outbound delivered, open case → active; c4 no open case → inactive;
// c5 has NO messages → excluded entirely; c6 no consent → canReply false.
const CUSTOMERS: ThreadCustomerInput[] = [
  { customerId: "c1", name: "Acme",    ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k1", latestInvoiceId: "i1" },
  { customerId: "c2", name: "Globex",  ownerId: null,  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k2", latestInvoiceId: "i2" },
  { customerId: "c3", name: "Initech", ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k3", latestInvoiceId: "i3" },
  { customerId: "c4", name: "Umbrella",ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: false, openCaseId: null, latestInvoiceId: "i4" },
  { customerId: "c5", name: "Stark",   ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                 hasOpenCase: true,  openCaseId: "k5", latestInvoiceId: "i5" },
  { customerId: "c6", name: "Wayne",   ownerId: "u1",  smsConsent: false, commPrefs: prefs({ doNotText: true }), hasOpenCase: true, openCaseId: "k6", latestInvoiceId: null },
];

const MESSAGES: ThreadMessageInput[] = [
  { customerId: "c1", direction: "outbound", body: "Hi",       status: "delivered", errorCode: null, invoiceId: "i1",  createdAt: "2026-06-20T10:00:00Z" },
  { customerId: "c1", direction: "inbound",  body: "Calling",  status: null,        errorCode: null, invoiceId: "i1",  createdAt: "2026-06-21T10:00:00Z" },
  { customerId: "c2", direction: "outbound", body: "Past due", status: "failed",    errorCode: "30007", invoiceId: "i2", createdAt: "2026-06-19T10:00:00Z" },
  { customerId: "c3", direction: "outbound", body: "Reminder", status: "delivered", errorCode: null, invoiceId: null,  createdAt: "2026-06-18T10:00:00Z" },
  { customerId: "c4", direction: "inbound",  body: "Paid?",    status: null,        errorCode: null, invoiceId: null,  createdAt: "2026-06-17T10:00:00Z" },
  { customerId: "c6", direction: "inbound",  body: "Stop pls", status: null,        errorCode: null, invoiceId: null,  createdAt: "2026-06-16T10:00:00Z" },
];
const LABELS = new Map([["u1", "diskin"]]);

test("frozen constants list every tab and sort", () => {
  expect(MESSAGE_TABS).toEqual(["needs-reply", "needs-attention", "active", "inactive", "all"]);
  expect(MESSAGE_SORTS).toEqual(["recent", "oldest-waiting", "name"]);
});

test("customers with zero messages are excluded; owner label resolves", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  expect(rows.map((r) => r.customerId).sort()).toEqual(["c1", "c2", "c3", "c4", "c6"]); // no c5
  const byId = new Map(rows.map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.ownerLabel).toBe("diskin");
  expect(byId.get("c2")!.ownerLabel).toBe("Unassigned"); // null owner
  expect(byId.get("c1")!.channel).toBe("sms");
});

test("needsReply, needsAttention, active, unansweredInbound derivation", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.needsReply).toBe(true);       // latest inbound
  expect(byId.get("c1")!.unansweredInbound).toBe(1);
  expect(byId.get("c2")!.needsAttention).toBe(true);   // latest outbound failed
  expect(byId.get("c2")!.needsReply).toBe(false);
  expect(byId.get("c3")!.needsAttention).toBe(false);  // delivered
  expect(byId.get("c3")!.active).toBe(true);           // open case
  expect(byId.get("c4")!.active).toBe(false);          // no open case
  expect(byId.get("c3")!.unansweredInbound).toBe(0);   // latest outbound
  expect(byId.get("c1")!.lastMessage!.direction).toBe("inbound");
});

test("needsAttention also trips on errorCode regardless of status string", () => {
  const msgs: ThreadMessageInput[] = [
    { customerId: "c1", direction: "outbound", body: "x", status: "sent", errorCode: "30008", invoiceId: "i1", createdAt: "2026-06-22T10:00:00Z" },
  ];
  const r = buildThreadRows([CUSTOMERS[0]], msgs, LABELS)[0];
  expect(r.needsAttention).toBe(true);
});

test("anchorInvoiceId: latest message's invoice, else customer's latest invoice, else null", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.anchorInvoiceId).toBe("i1"); // from messages
  expect(byId.get("c3")!.anchorInvoiceId).toBe("i3"); // messages have null invoice → fallback latestInvoiceId
  expect(byId.get("c6")!.anchorInvoiceId).toBe(null); // no msg invoice, no latest invoice
});

test("canReply truth table + replyDisabledReason precedence", () => {
  const byId = new Map(buildThreadRows(CUSTOMERS, MESSAGES, LABELS).map((r) => [r.customerId, r]));
  expect(byId.get("c1")!.canReply).toBe(true);
  expect(byId.get("c1")!.replyDisabledReason).toBe(null);
  expect(byId.get("c6")!.canReply).toBe(false);
  expect(byId.get("c6")!.replyDisabledReason).toBe("Customer has not consented to SMS");
  // consent ok but no invoice
  const noInv: ThreadCustomerInput = { ...CUSTOMERS[0], customerId: "c9", latestInvoiceId: null };
  const msgs: ThreadMessageInput[] = [
    { customerId: "c9", direction: "inbound", body: "hi", status: null, errorCode: null, invoiceId: null, createdAt: "2026-06-22T10:00:00Z" },
  ];
  const r = buildThreadRows([noInv], msgs, LABELS)[0];
  expect(r.canReply).toBe(false);
  expect(r.replyDisabledReason).toBe("No invoice on file to attach");
});

test("applyMessageTab partitions by tab", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  const ids = (tab: any) => applyMessageTab(rows, tab).map((r) => r.customerId).sort();
  expect(ids("needs-reply")).toEqual(["c1", "c4", "c6"]);     // latest inbound
  expect(ids("needs-attention")).toEqual(["c2"]);
  expect(ids("active")).toEqual(["c1", "c2", "c3", "c6"]);    // open case
  expect(ids("inactive")).toEqual(["c4"]);
  expect(applyMessageTab(rows, "all").length).toBe(5);
});

test("sortThreadRows: recent desc, oldest-waiting (needs-reply oldest first), name asc", () => {
  const rows = buildThreadRows(CUSTOMERS, MESSAGES, LABELS);
  expect(sortThreadRows(rows, "recent").map((r) => r.customerId)[0]).toBe("c1"); // 06-21 newest
  expect(sortThreadRows(rows, "name").map((r) => r.customerName)[0]).toBe("Acme");
  const ow = sortThreadRows(rows, "oldest-waiting").map((r) => r.customerId);
  expect(ow.slice(0, 3)).toEqual(["c6", "c4", "c1"]); // needs-reply rows, oldest createdAt first
});

test("computeMessageMetrics counts", () => {
  const m = computeMessageMetrics(buildThreadRows(CUSTOMERS, MESSAGES, LABELS));
  expect(m.needsReply).toBe(3);
  expect(m.needsAttention).toBe(1);
  expect(m.active).toBe(4);
  expect(m.unanswered).toBe(3); // rows with unansweredInbound > 0 (c1, c4, c6)
});
