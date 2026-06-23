// Pure derived-intelligence for the collections worklist. No I/O. Ported and
// typed from the prototype domain.js. Computed server-side; the browser only
// renders the result.

export type HeatBand = "cool" | "warm" | "hot";
export type Heat = { band: HeatBand; label: "COOL" | "WARM" | "HOT"; days: number };
export type Priority = { level: "Critical" | "High" | "Medium" | "Low"; tone: HeatBand; reason: string; rank: number };
export type NextAction = { label: string; tone: HeatBand | "neutral" };
export type LastContact = { date: string; channel: string } | null;

export type WorkItem = {
  invoiceId: string;
  docNumber: string | null;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  owner: string;
  balance: number;
  customerBalance: number;
  dueDate: string | null;
  ageDays: number;
  heat: Heat;
  priority: Priority;
  nextAction: NextAction;
  lastContact: LastContact;
  invoiceCount: number;
  searchText: string;
};

export type Metric = { count: number; amount: number };
export type Metrics = { thirtyPlus: Metric; highValue: Metric; neverContacted: Metric; allOpen: Metric };
export type ViewId = "all-open" | "30-plus" | "high-value" | "never-contacted";
export type SortId = "recommended" | "most-overdue" | "highest-balance" | "customer";

export type InvoiceInput = { id: string; qbo_doc_number: string | null; customer_id: string | null; balance: number; due_date: string | null };
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null };
export type LastContactInput = { invoiceId: string; date: string; channel: string };

export const HIGH_VALUE_THRESHOLD = 5000;

function dayNumber(value: string): number {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function ageInDays(dueDate: string, today: string): number {
  return dayNumber(today) - dayNumber(dueDate);
}

export function heatOf(ageDays: number): Heat {
  if (ageDays >= 90) return { band: "hot", label: "HOT", days: ageDays };
  if (ageDays >= 30) return { band: "warm", label: "WARM", days: ageDays };
  return { band: "cool", label: "COOL", days: ageDays };
}

export function priorityOf(ageDays: number, neverContacted: boolean): Priority {
  if (ageDays >= 90) {
    const reason = neverContacted ? `${ageDays} days overdue, never contacted` : `${ageDays} days overdue`;
    return { level: "Critical", tone: "hot", reason, rank: 0 };
  }
  if (ageDays >= 60) return { level: "High", tone: "warm", reason: `${ageDays} days overdue`, rank: 1 };
  if (ageDays >= 30) return { level: "Medium", tone: "warm", reason: `${ageDays} days overdue`, rank: 2 };
  return { level: "Low", tone: "cool", reason: ageDays > 0 ? `${ageDays} days overdue` : "Not yet due", rank: 3 };
}

export function nextActionOf(ageDays: number, neverContacted: boolean): NextAction {
  if (neverContacted && ageDays >= 30) return { label: "Contact today", tone: "hot" };
  if (neverContacted) return { label: "Make first contact", tone: "warm" };
  if (ageDays >= 90) return { label: "Escalate", tone: "hot" };
  return { label: "Follow up", tone: "warm" };
}

export function buildWorkItems(
  invoices: InvoiceInput[], customers: CustomerInput[], lastContacts: LastContactInput[], today: string,
): WorkItem[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const lastByInvoice = new Map(lastContacts.map((l) => [l.invoiceId, l]));
  const customerBalance = new Map<string, number>();
  const customerInvoiceCount = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    customerBalance.set(inv.customer_id, (customerBalance.get(inv.customer_id) ?? 0) + Number(inv.balance || 0));
    customerInvoiceCount.set(inv.customer_id, (customerInvoiceCount.get(inv.customer_id) ?? 0) + 1);
  }

  return invoices.map((inv) => {
    const cust = inv.customer_id ? customerById.get(inv.customer_id) ?? null : null;
    const ageDays = inv.due_date ? ageInDays(inv.due_date, today) : 0;
    const lc = lastByInvoice.get(inv.id) ?? null;
    const neverContacted = !lc;
    const balance = Number(inv.balance || 0);
    const name = cust?.name ?? "(unknown customer)";
    return {
      invoiceId: inv.id,
      docNumber: inv.qbo_doc_number,
      customerId: inv.customer_id,
      customerName: name,
      phone: cust?.phone ?? null,
      email: cust?.email ?? null,
      owner: "Unassigned",
      balance,
      customerBalance: inv.customer_id ? customerBalance.get(inv.customer_id) ?? balance : balance,
      dueDate: inv.due_date,
      ageDays,
      heat: heatOf(ageDays),
      priority: priorityOf(ageDays, neverContacted),
      nextAction: nextActionOf(ageDays, neverContacted),
      lastContact: lc ? { date: lc.date, channel: lc.channel } : null,
      invoiceCount: inv.customer_id ? customerInvoiceCount.get(inv.customer_id) ?? 1 : 1,
      searchText: [name, inv.qbo_doc_number ?? "", cust?.phone ?? "", cust?.email ?? ""].join(" ").toLowerCase(),
    };
  });
}

export function applyView(items: WorkItem[], view: ViewId): WorkItem[] {
  if (view === "30-plus") return items.filter((i) => i.ageDays >= 30);
  if (view === "high-value") return items.filter((i) => i.balance >= HIGH_VALUE_THRESHOLD);
  if (view === "never-contacted") return items.filter((i) => i.lastContact === null);
  return items;
}

export function sortItems(items: WorkItem[], sort: SortId): WorkItem[] {
  const copy = [...items];
  if (sort === "most-overdue") return copy.sort((a, b) => b.ageDays - a.ageDays);
  if (sort === "highest-balance") return copy.sort((a, b) => b.balance - a.balance);
  if (sort === "customer") return copy.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return copy.sort((a, b) => a.priority.rank - b.priority.rank || b.ageDays - a.ageDays || b.balance - a.balance);
}

export function computeMetrics(items: WorkItem[]): Metrics {
  const bucket = (pred: (i: WorkItem) => boolean): Metric => {
    const matched = items.filter(pred);
    return { count: matched.length, amount: matched.reduce((s, i) => s + i.balance, 0) };
  };
  return {
    thirtyPlus: bucket((i) => i.ageDays >= 30),
    highValue: bucket((i) => i.balance >= HIGH_VALUE_THRESHOLD),
    neverContacted: bucket((i) => i.lastContact === null),
    allOpen: bucket(() => true),
  };
}
