// Pure "Coming Due" intelligence — invoices approaching their due date (within
// 7 days, not yet overdue). Read-only awareness; no cases are opened for these.
// No I/O, no .server suffix.

import { ageInDays, type InvoiceInput, type CustomerInput, type Metric } from "./worklist";

/** How many calendar days ahead the "coming due" window spans (inclusive). */
export const COMING_DUE_DAYS = 7;

export type ComingDueInvoice = {
  invoiceId: string;
  docNumber: string | null;
  balance: number;
  dueDate: string;
  daysUntilDue: number; // 0 = due today, positive = days until due
};

export type ComingDueGroup = {
  customerId: string;
  customerName: string;
  totalBalance: number;
  nextDueDate: string;
  invoices: ComingDueInvoice[];
};

/**
 * Is this invoice coming due (due today through +`days` days)?
 * `ageInDays(dueDate, today)` returns negative when `dueDate` is in the future.
 * Coming due = `ageInDays` in [-days, 0] — i.e. due today (0) through `days`
 * days away. `days` defaults to COMING_DUE_DAYS but org config may override it.
 */
export function isComingDue(dueDate: string, today: string, days: number = COMING_DUE_DAYS): boolean {
  const age = ageInDays(dueDate, today);
  return age >= -days && age <= 0;
}

/**
 * Build grouped, sorted "Coming Due" rows from raw invoice + customer data.
 * Filters to `balance > 0 && dueDate != null && isComingDue(...)`.
 * Groups by customer (id → group), sorts groups by nextDueDate asc then name,
 * invoices within each group by daysUntilDue asc (soonest first).
 * `comingDueDays` (default COMING_DUE_DAYS) sizes the lookahead window — pass
 * the org-configured value so the display window matches the query window.
 */
export function buildComingDueGroups(
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  today: string,
  comingDueDays: number = COMING_DUE_DAYS,
): ComingDueGroup[] {
  const custById = new Map(customers.map((c) => [c.id, c]));
  const grouped = new Map<string, { cust: CustomerInput; invs: ComingDueInvoice[] }>();

  for (const inv of invoices) {
    if (!inv.customer_id || !inv.due_date || inv.balance <= 0) continue;
    if (!isComingDue(inv.due_date, today, comingDueDays)) continue;

    const daysUntilDue = -ageInDays(inv.due_date, today); // positive = future
    const cdi: ComingDueInvoice = {
      invoiceId: inv.id,
      docNumber: inv.qbo_doc_number,
      balance: Number(inv.balance),
      dueDate: inv.due_date,
      daysUntilDue,
    };

    const existing = grouped.get(inv.customer_id);
    if (existing) {
      existing.invs.push(cdi);
    } else {
      const cust = custById.get(inv.customer_id) ?? { id: inv.customer_id, name: "(unknown)", phone: null, email: null };
      grouped.set(inv.customer_id, { cust, invs: [cdi] });
    }
  }

  const groups: ComingDueGroup[] = [];
  for (const [customerId, { cust, invs }] of grouped) {
    invs.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
    const totalBalance = invs.reduce((s, i) => s + i.balance, 0);
    groups.push({
      customerId,
      customerName: cust.name,
      totalBalance,
      nextDueDate: invs[0].dueDate,
      invoices: invs,
    });
  }

  groups.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.customerName.localeCompare(b.customerName));
  return groups;
}

/** Metric for the "Coming due" tile: count = number of customers, amount = total. */
export function comingDueMetric(groups: ComingDueGroup[]): Metric {
  return {
    count: groups.length,
    amount: groups.reduce((s, g) => s + g.totalBalance, 0),
  };
}
