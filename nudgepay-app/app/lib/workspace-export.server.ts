import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "./page-all";
import { buildWorkspaceDataExport, type WorkspaceDataExport } from "./workspace-export";

async function takeRows(
  service: SupabaseClient,
  table: string,
  columns: string,
  orgId: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  // PostgREST max_rows is 1000; pageAll walks ranges up to PAGE_ALL_MAX_ROWS.
  return pageAll(async (from, to) => {
    const { data, error, count } = await service
      .from(table)
      .select(columns, { count: "exact" })
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (data ?? null) as Record<string, unknown>[] | null,
      count,
      error,
    };
  });
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export async function loadWorkspaceDataExport(
  service: SupabaseClient,
  orgId: string,
  orgName: string,
  exportedAt: string,
): Promise<WorkspaceDataExport> {
  const [
    memberships,
    customers,
    invoices,
    cases,
    promises,
    contactLogs,
    textMessages,
    emailMessages,
  ] = await Promise.all([
    takeRows(service, "memberships", "user_id, role", orgId),
    takeRows(service, "customers", "id, name, email, phone, erased_at", orgId),
    takeRows(service, "invoices", "id, customer_id, qbo_doc_number, amount, balance, due_date, status", orgId),
    takeRows(service, "collection_cases", "id, customer_id, status, closed_at", orgId),
    takeRows(service, "promises", "id, customer_id, case_id, status, promised_amount, promised_date, resolved_at", orgId),
    takeRows(service, "contact_logs", "id, customer_id, created_at, method, outcome", orgId),
    takeRows(service, "text_messages", "id, customer_id, created_at, direction, body", orgId),
    takeRows(service, "email_messages", "id, customer_id, created_at, direction, subject, body", orgId),
  ]);

  return buildWorkspaceDataExport({
    exportedAt,
    truncated:
      memberships.truncated || customers.truncated || invoices.truncated ||
      cases.truncated || promises.truncated || contactLogs.truncated ||
      textMessages.truncated || emailMessages.truncated,
    workspace: { id: orgId, name: orgName },
    memberships: {
      truncated: memberships.truncated,
      rows: memberships.rows.map((r) => ({
        userId: String(r.user_id),
        role: String(r.role ?? "member"),
      })),
    },
    customers: {
      truncated: customers.truncated,
      rows: customers.rows.map((r) => ({
        id: String(r.id),
        name: typeof r.name === "string" ? r.name : null,
        email: typeof r.email === "string" ? r.email : null,
        phone: typeof r.phone === "string" ? r.phone : null,
        erasedAt: typeof r.erased_at === "string" ? r.erased_at : null,
      })),
    },
    invoices: {
      truncated: invoices.truncated,
      rows: invoices.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        docNumber: typeof r.qbo_doc_number === "string" ? r.qbo_doc_number : null,
        amount: num(r.amount),
        balance: num(r.balance),
        dueDate: typeof r.due_date === "string" ? r.due_date : null,
        status: typeof r.status === "string" ? r.status : null,
      })),
    },
    cases: {
      truncated: cases.truncated,
      rows: cases.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        status: typeof r.status === "string" ? r.status : null,
        closedAt: typeof r.closed_at === "string" ? r.closed_at : null,
      })),
    },
    promises: {
      truncated: promises.truncated,
      rows: promises.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        caseId: typeof r.case_id === "string" ? r.case_id : null,
        status: typeof r.status === "string" ? r.status : null,
        promisedAmount: num(r.promised_amount),
        promisedDate: typeof r.promised_date === "string" ? r.promised_date : null,
        resolvedAt: typeof r.resolved_at === "string" ? r.resolved_at : null,
      })),
    },
    contactLogs: {
      truncated: contactLogs.truncated,
      rows: contactLogs.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        createdAt: String(r.created_at ?? ""),
        method: String(r.method ?? ""),
        outcome: typeof r.outcome === "string" ? r.outcome : null,
      })),
    },
    textMessages: {
      truncated: textMessages.truncated,
      rows: textMessages.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        createdAt: String(r.created_at ?? ""),
        direction: String(r.direction ?? ""),
        body: typeof r.body === "string" ? r.body : null,
      })),
    },
    emailMessages: {
      truncated: emailMessages.truncated,
      rows: emailMessages.rows.map((r) => ({
        id: String(r.id),
        customerId: typeof r.customer_id === "string" ? r.customer_id : null,
        createdAt: String(r.created_at ?? ""),
        direction: String(r.direction ?? ""),
        subject: typeof r.subject === "string" ? r.subject : null,
        body: typeof r.body === "string" ? r.body : null,
      })),
    },
  });
}
