// app/lib/accounts.ts
// Pure derived-intelligence for the customer directory (Accounts tab). No I/O,
// no node:*, no .server — imported by the route loader, the directory/profile
// components (type-only), and tests. Mirrors the worklist/cases aggregation shape.

import { ageInDays, type CustomerInput, type InvoiceInput, type LastContact } from "./worklist";
import { DEFAULT_COMM_PREFS, type CommPrefs } from "./comm-prefs";

export type AccountStanding = "current" | "overdue" | "in_collections" | "on_hold";

// Presence of a customerId in the cases array = that customer has an OPEN case.
export type AccountCaseInput = { customerId: string; onHold: boolean };
export type AccountLastContactInput = { customerId: string; date: string; channel: string };

export type AccountRow = {
  customerId: string;
  name: string;
  ownerId: string | null;
  owner: string;
  email: string | null;
  phone: string | null;
  openBalance: number;
  openInvoiceCount: number;
  oldestOverdueDays: number;
  hasActiveCase: boolean;
  onHold: boolean;
  standing: AccountStanding;
  commPrefs: CommPrefs;
  smsConsent: boolean;
  lastContact: LastContact;
  searchText: string;
};

export function deriveStanding(input: {
  openBalance: number; hasActiveCase: boolean; onHold: boolean;
}): AccountStanding {
  if (input.onHold) return "on_hold";
  if (input.openBalance <= 0) return "current";
  if (input.hasActiveCase) return "in_collections";
  return "overdue";
}

export function buildAccountRows(
  customers: CustomerInput[],
  invoices: InvoiceInput[],
  cases: AccountCaseInput[],
  lastContacts: AccountLastContactInput[],
  today: string,
  ownerLabels: Map<string, string>,
): AccountRow[] {
  // Open-invoice aggregation per customer (caller passes only balance>0 invoices).
  const balanceByCustomer = new Map<string, number>();
  const countByCustomer = new Map<string, number>();
  const oldestByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    const bal = Number(inv.balance || 0);
    balanceByCustomer.set(inv.customer_id, (balanceByCustomer.get(inv.customer_id) ?? 0) + bal);
    countByCustomer.set(inv.customer_id, (countByCustomer.get(inv.customer_id) ?? 0) + 1);
    const age = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    if (age > 0) {
      oldestByCustomer.set(inv.customer_id, Math.max(oldestByCustomer.get(inv.customer_id) ?? 0, age));
    }
  }

  const caseByCustomer = new Map(cases.map((c) => [c.customerId, c]));

  // Newest contact per customer (explicit max-by-date; do not rely on order).
  const lastByCustomer = new Map<string, AccountLastContactInput>();
  for (const lc of lastContacts) {
    const prev = lastByCustomer.get(lc.customerId);
    if (!prev || lc.date > prev.date) lastByCustomer.set(lc.customerId, lc);
  }

  return customers.map((cust) => {
    const openBalance = balanceByCustomer.get(cust.id) ?? 0;
    const cse = caseByCustomer.get(cust.id) ?? null;
    const hasActiveCase = cse != null;
    const onHold = cse?.onHold ?? false;
    const ownerId = cust.owner ?? null;
    const owner = ownerId ? (ownerLabels.get(ownerId) ?? "Unknown") : "Unassigned";
    const lc = lastByCustomer.get(cust.id) ?? null;
    return {
      customerId: cust.id,
      name: cust.name,
      ownerId,
      owner,
      email: cust.email ?? null,
      phone: cust.phone ?? null,
      openBalance,
      openInvoiceCount: countByCustomer.get(cust.id) ?? 0,
      oldestOverdueDays: oldestByCustomer.get(cust.id) ?? 0,
      hasActiveCase,
      onHold,
      standing: deriveStanding({ openBalance, hasActiveCase, onHold }),
      commPrefs: cust.commPrefs ?? DEFAULT_COMM_PREFS,
      smsConsent: cust.smsConsent ?? false,
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      searchText: [cust.name, cust.phone ?? "", cust.email ?? "", owner].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}
