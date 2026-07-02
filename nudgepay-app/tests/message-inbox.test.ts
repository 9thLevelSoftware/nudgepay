import { describe, expect, it, test } from "vitest";
import {
  buildThreadRows, applyMessageTab, applyChannelFilter, sortThreadRows, computeMessageMetrics,
  MESSAGE_TABS, MESSAGE_SORTS,
  type ThreadCustomerInput, type ThreadMessageInput,
} from "../app/lib/message-inbox";
import { DEFAULT_COMM_PREFS, resolveCommPrefs } from "../app/lib/comm-prefs";

const prefs = (over = {}) => ({ ...DEFAULT_COMM_PREFS, ...over });

// c1 latest=inbound → needsReply; c2 latest=outbound failed → needsAttention;
// c3 latest=outbound delivered, open case → active; c4 no open case → inactive;
// c5 has NO messages → excluded entirely; c6 no consent → canReply false.
const CUSTOMERS: ThreadCustomerInput[] = [
  { customerId: "c1", name: "Acme",    ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                    email: "acme@example.com",     phone: "+13105550101", hasOpenCase: true,  openCaseId: "k1", latestInvoiceId: "i1", contactBlocked: false },
  { customerId: "c2", name: "Globex",  ownerId: null,  smsConsent: true,  commPrefs: prefs(),                    email: "globex@example.com",   phone: "+13105550102", hasOpenCase: true,  openCaseId: "k2", latestInvoiceId: "i2", contactBlocked: false },
  { customerId: "c3", name: "Initech", ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                    email: "initech@example.com",  phone: "+13105550103", hasOpenCase: true,  openCaseId: "k3", latestInvoiceId: "i3", contactBlocked: false },
  { customerId: "c4", name: "Umbrella",ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                    email: "umbrella@example.com", phone: "+13105550104", hasOpenCase: false, openCaseId: null, latestInvoiceId: "i4", contactBlocked: false },
  { customerId: "c5", name: "Stark",   ownerId: "u1",  smsConsent: true,  commPrefs: prefs(),                    email: "stark@example.com",    phone: "+13105550105", hasOpenCase: true,  openCaseId: "k5", latestInvoiceId: "i5", contactBlocked: false },
  { customerId: "c6", name: "Wayne",   ownerId: "u1",  smsConsent: false, commPrefs: prefs({ doNotText: true }), email: null,                   phone: "+13105550106", hasOpenCase: true,  openCaseId: "k6", latestInvoiceId: null, contactBlocked: false },
];

const MESSAGES: ThreadMessageInput[] = [
  { customerId: "c1", channel: "sms", direction: "outbound", body: "Hi",       subject: null, status: "delivered", errorCode: null,     invoiceId: "i1",  createdAt: "2026-06-20T10:00:00Z" },
  { customerId: "c1", channel: "sms", direction: "inbound",  body: "Calling",  subject: null, status: null,        errorCode: null,     invoiceId: "i1",  createdAt: "2026-06-21T10:00:00Z" },
  { customerId: "c2", channel: "sms", direction: "outbound", body: "Past due", subject: null, status: "failed",    errorCode: "30007",  invoiceId: "i2",  createdAt: "2026-06-19T10:00:00Z" },
  { customerId: "c3", channel: "sms", direction: "outbound", body: "Reminder", subject: null, status: "delivered", errorCode: null,     invoiceId: null,  createdAt: "2026-06-18T10:00:00Z" },
  { customerId: "c4", channel: "sms", direction: "inbound",  body: "Paid?",    subject: null, status: null,        errorCode: null,     invoiceId: null,  createdAt: "2026-06-17T10:00:00Z" },
  { customerId: "c6", channel: "sms", direction: "inbound",  body: "Stop pls", subject: null, status: null,        errorCode: null,     invoiceId: null,  createdAt: "2026-06-16T10:00:00Z" },
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
    { customerId: "c1", channel: "sms", direction: "outbound", body: "x", subject: null, status: "sent", errorCode: "30008", invoiceId: "i1", createdAt: "2026-06-22T10:00:00Z" },
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
  expect(byId.get("c6")!.replyDisabledReason).toBe("Customer opted out of texts");
  // consent ok but no invoice
  const noInv: ThreadCustomerInput = { ...CUSTOMERS[0], customerId: "c9", latestInvoiceId: null };
  const msgs: ThreadMessageInput[] = [
    { customerId: "c9", channel: "sms", direction: "inbound", body: "hi", subject: null, status: null, errorCode: null, invoiceId: null, createdAt: "2026-06-22T10:00:00Z" },
  ];
  const r = buildThreadRows([noInv], msgs, LABELS)[0];
  expect(r.canReply).toBe(false);
  expect(r.replyDisabledReason).toBe("No invoice on file to attach");
  // consent ok (smsConsent true) but customer opted out via doNotText
  const optedOut: ThreadCustomerInput = { ...CUSTOMERS[0], customerId: "c10", smsConsent: true, commPrefs: prefs({ doNotText: true }) };
  const optedOutMsgs: ThreadMessageInput[] = [
    { customerId: "c10", channel: "sms", direction: "inbound", body: "hi", subject: null, status: null, errorCode: null, invoiceId: "i1", createdAt: "2026-06-22T10:00:00Z" },
  ];
  const ro = buildThreadRows([optedOut], optedOutMsgs, LABELS)[0];
  expect(ro.canReply).toBe(false);
  expect(ro.replyDisabledReason).toBe("Customer opted out of texts");
  // consent ok, not opted out, has an invoice — but no phone on file
  const noPhone: ThreadCustomerInput = { ...CUSTOMERS[0], customerId: "c11", phone: null };
  const noPhoneMsgs: ThreadMessageInput[] = [
    { customerId: "c11", channel: "sms", direction: "inbound", body: "hi", subject: null, status: null, errorCode: null, invoiceId: "i1", createdAt: "2026-06-22T10:00:00Z" },
  ];
  const rp = buildThreadRows([noPhone], noPhoneMsgs, LABELS)[0];
  expect(rp.canReply).toBe(false);
  expect(rp.replyDisabledReason).toBe("Customer has no phone number");
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
  expect(m.unanswered).toBe(3); // threads with the customer waiting on us (== needsReply for per-customer threads)
});

const labels = new Map<string, string>([["u1", "Owner One"]]);

function cust(over: Partial<ThreadCustomerInput> = {}): ThreadCustomerInput {
  return {
    customerId: "c1", name: "Acme", ownerId: "u1",
    smsConsent: true, commPrefs: resolveCommPrefs({}), phone: "5551234567",
    email: "a@acme.com", hasOpenCase: true, openCaseId: "case1", latestInvoiceId: "inv1",
    contactBlocked: false,
    ...over,
  };
}
function msg(over: Partial<ThreadMessageInput> = {}): ThreadMessageInput {
  return {
    customerId: "c1", channel: "sms", direction: "outbound", body: "hi", subject: null,
    status: "sent", errorCode: null, invoiceId: "inv1", createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("message-inbox channel awareness", () => {
  it("REGRESSION: an SMS-only customer yields one sms row with the old gate", () => {
    const rows = buildThreadRows([cust()], [msg({ channel: "sms", direction: "inbound" })], labels);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("sms");
    expect(rows[0].canReply).toBe(true);
    expect(rows[0].needsReply).toBe(true);
    expect(rows[0].subjectSnippet).toBeNull();
  });

  it("a customer with both channels yields two rows", () => {
    const rows = buildThreadRows([cust()], [
      msg({ channel: "sms" }),
      msg({ channel: "email", subject: "Invoice 1001", body: "please pay" }),
    ], labels);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "sms"]);
    const email = rows.find((r) => r.channel === "email")!;
    expect(email.subjectSnippet).toBe("Invoice 1001");
  });

  it("email gate: opted out", () => {
    const rows = buildThreadRows([cust({ commPrefs: resolveCommPrefs({ do_not_email: true }) })],
      [msg({ channel: "email", subject: "x" })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/opted out of email/i);
  });

  it("email gate: no email on file", () => {
    const rows = buildThreadRows([cust({ email: null })], [msg({ channel: "email", subject: "x" })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/no email/i);
  });

  it("email gate: no invoice to attach", () => {
    const rows = buildThreadRows([cust({ latestInvoiceId: null })],
      [msg({ channel: "email", subject: "x", invoiceId: null })], labels);
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/invoice/i);
  });

  it("bounced/complained trip needsAttention", () => {
    const bounced = buildThreadRows([cust()], [msg({ channel: "email", subject: "x", status: "bounced" })], labels);
    expect(bounced[0].needsAttention).toBe(true);
  });

  it("applyChannelFilter narrows by channel", () => {
    const rows = buildThreadRows([cust()], [msg({ channel: "sms" }), msg({ channel: "email", subject: "x" })], labels);
    expect(applyChannelFilter(rows, "sms").map((r) => r.channel)).toEqual(["sms"]);
    expect(applyChannelFilter(rows, "email").map((r) => r.channel)).toEqual(["email"]);
    expect(applyChannelFilter(rows, "all")).toHaveLength(2);
  });

  it("metrics count across both channels", () => {
    const rows = buildThreadRows([cust()], [
      msg({ channel: "sms", direction: "inbound" }),
      msg({ channel: "email", subject: "x", direction: "inbound" }),
    ], labels);
    expect(computeMessageMetrics(rows).needsReply).toBe(2);
  });
});

describe("message-inbox gate parity (P5 fixes)", () => {
  it("smsGate: doNotText wins over smsConsent=false", () => {
    // Both opted out AND no consent — reason should be the opt-out, not the consent
    const rows = buildThreadRows(
      [cust({ smsConsent: false, commPrefs: resolveCommPrefs({ do_not_text: true }) })],
      [msg({ channel: "sms", direction: "inbound" })],
      labels,
    );
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toBe("Customer opted out of texts");
  });

  it("smsGate: contactBlocked gates first with blocked reason", () => {
    const rows = buildThreadRows(
      [cust({ contactBlocked: true })],
      [msg({ channel: "sms", direction: "inbound" })],
      labels,
    );
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/do-not-contact|legal/i);
  });

  it("emailGate: contactBlocked gates first with blocked reason", () => {
    const rows = buildThreadRows(
      [cust({ contactBlocked: true })],
      [msg({ channel: "email", subject: "Invoice", direction: "inbound" })],
      labels,
    );
    expect(rows[0].canReply).toBe(false);
    expect(rows[0].replyDisabledReason).toMatch(/do-not-contact|legal/i);
  });
});
