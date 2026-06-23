import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { parseContactLogForm } from "../app/lib/contact-log";
import { action as _contactLogAction } from "../app/routes/api.contact-logs";

// ── Task 1: migration columns exist and accept promise data ──────────────────
test("contact_logs accepts promised_amount and promised_date", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Promise Cols Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pc-c1", name: "Promise Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "pc-i1", customer_id: cust!.id, amount: 1000, balance: 1000, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("promise-cols@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });

  const { data: row, error } = await svc.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "spoke with AP",
    promised_amount: 500.5, promised_date: "2026-07-01",
  }).select("promised_amount, promised_date").single();

  expect(error).toBeNull();
  expect(Number(row!.promised_amount)).toBe(500.5);
  expect(row!.promised_date).toBe("2026-07-01");
});

// ── Task 3: parseContactLogForm pure validator ───────────────────────────────

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

test("parse: valid call with no promise", () => {
  const r = parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "no-answer" }));
  expect(r).toEqual({ ok: true, fields: {
    invoiceId: "i1", customerId: null, method: "call", outcome: "no-answer",
    notes: null, followUpAt: null, promisedAmount: null, promisedDate: null,
  }});
});

test("parse: promise-to-pay requires amount and date", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay" })))
    .toEqual({ ok: false, error: "promise-required" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "500" })))
    .toEqual({ ok: false, error: "promise-required" });
});

test("parse: promise-to-pay valid", () => {
  const r = parseContactLogForm(fd({
    invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    promisedAmount: "500.50", promisedDate: "2026-07-01", notes: "  AP will pay  ", followUpAt: "2026-07-02",
  }));
  expect(r).toEqual({ ok: true, fields: {
    invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    notes: "AP will pay", followUpAt: "2026-07-02", promisedAmount: 500.5, promisedDate: "2026-07-01",
  }});
});

test("parse: rejects bad amount, bad date, bad method, bad outcome, missing invoice", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "-5", promisedDate: "2026-07-01" })).ok).toBe(false);
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "abc", promisedDate: "2026-07-01" }))).toEqual({ ok: false, error: "bad-amount" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "promise-to-pay", promisedAmount: "500", promisedDate: "nope" }))).toEqual({ ok: false, error: "bad-date" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "smoke", outcome: "no-answer" }))).toEqual({ ok: false, error: "bad-method" });
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "call", outcome: "vibes" }))).toEqual({ ok: false, error: "bad-outcome" });
  expect(parseContactLogForm(fd({ method: "call", outcome: "no-answer" }))).toEqual({ ok: false, error: "missing-invoice" });
});

test("parse: rejects malformed follow-up date", () => {
  expect(parseContactLogForm(fd({ invoiceId: "i1", method: "note", outcome: "other", followUpAt: "2026-13-99" })))
    .toEqual({ ok: false, error: "bad-date" });
});

// ── Task 4: RLS user client inserts a contact log ────────────────────────────

// Build a minimal env/context the action expects (getEnv reads from context).
// The action uses requireUser (cookie-based). For a direct-call test we instead
// assert the RLS insert path via a user client, mirroring the action's writes.
test("RLS user client inserts a contact log readable back within the org", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Log Insert Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "li-c1", name: "Logged Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "li-i1", customer_id: cust!.id, amount: 900, balance: 900, due_date: "2026-02-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("log-insert@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  const { error: insErr } = await user.client.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "will pay",
    promised_amount: 300, promised_date: "2026-07-15", follow_up_at: null,
  });
  expect(insErr).toBeNull();

  const { data: rows } = await user.client.from("contact_logs")
    .select("user_id, method, promised_amount, promised_date").eq("invoice_id", inv!.id);
  expect(rows!.length).toBe(1);
  expect(rows![0].user_id).toBe(user.userId);
  expect(Number(rows![0].promised_amount)).toBe(300);
  expect(rows![0].promised_date).toBe("2026-07-15");
});
