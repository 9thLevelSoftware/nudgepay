import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { loadOrgConfig } from "../lib/org-config.server";
import {
  buildPromiseRows,
  applyPromiseTab,
  sortPromiseRows,
  computePromiseMetrics,
  PROMISE_TABS,
  PROMISE_SORTS,
  type PromiseTab,
  type PromiseSort,
  type PromiseInput,
  type PromiseLinkedInvoice,
} from "../lib/promise-ledger";
import { AppShell } from "../components/AppShell";
import { PromisesMetrics } from "../components/PromisesMetrics";
import { PromisesLedger } from "../components/PromisesLedger";
import { PromiseQuickPanel } from "../components/PromiseQuickPanel";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/promises";

export const meta: Route.MetaFunction = () => pageTitle("Promises");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, service, headers, isOwner, org,
    orgName, initials, connected, syncLabel,
  } = await loadWorkspaceChrome(request, env);
  // requireQbo defaults true — gate already handled inside helper

  // --- URL params ---
  const url = new URL(request.url);
  const sp = url.searchParams;
  const tab: PromiseTab = (PROMISE_TABS as string[]).includes(sp.get("tab") ?? "")
    ? (sp.get("tab") as PromiseTab)
    : "due-soon";
  const sort: PromiseSort = (PROMISE_SORTS as string[]).includes(sp.get("sort") ?? "")
    ? (sp.get("sort") as PromiseSort)
    : "due-date";
  const promiseId = sp.get("promiseId");

  const today = new Date().toISOString().slice(0, 10);

  // --- Org config for the due-soon business-day window ---
  const config = await loadOrgConfig(supabase, org.org_id);

  // --- Data loading (USER client, explicit org_id scope) ---
  const { data: promiseRows } = await supabase
    .from("promises")
    .select("id, case_id, customer_id, status, promised_amount, amount_received, baseline_balance, promised_date, grace_until, created_at, contact_log_id")
    .eq("org_id", org.org_id);
  const rawPromises = (promiseRows as any[]) ?? [];

  // Only the customers referenced by promises (not the whole directory).
  const customerIds = Array.from(new Set(rawPromises.map((r) => r.customer_id as string)));
  let custRows: any[] = [];
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("customers").select("id, name, owner").eq("org_id", org.org_id).in("id", customerIds);
    custRows = (data as any[]) ?? [];
  }
  const custById = new Map(custRows.map((c) => [c.id, c]));

  // Open/closed state per referenced case — a closed case can't be selected by
  // the Collections deep-link (dashboard loads only `closed_at is null`).
  const caseIds = Array.from(new Set(rawPromises.map((r) => r.case_id as string)));
  let openCaseIds = new Set<string>();
  if (caseIds.length > 0) {
    const { data: caseRows } = await supabase
      .from("collection_cases").select("id, closed_at").eq("org_id", org.org_id).in("id", caseIds);
    openCaseIds = new Set(
      ((caseRows as any[]) ?? []).filter((c) => c.closed_at == null).map((c) => c.id as string),
    );
  }

  // Live linked-invoice balance per PENDING promise → read-time received
  // (the persisted amount_received lags until the evaluator settles the promise).
  const pendingIds = rawPromises.filter((r) => r.status === "pending").map((r) => r.id as string);
  const liveLinkedBalanceByPromiseId = new Map<string, number>();
  if (pendingIds.length > 0) {
    const { data: piRows } = await supabase
      .from("promise_invoices").select("promise_id, invoice_id").eq("org_id", org.org_id).in("promise_id", pendingIds);
    const links = (piRows as any[]) ?? [];
    const linkInvIds = Array.from(new Set(links.map((l) => l.invoice_id as string)));
    const balById = new Map<string, number>();
    if (linkInvIds.length > 0) {
      const { data: invRows } = await supabase
        .from("invoices").select("id, balance").eq("org_id", org.org_id).in("id", linkInvIds);
      for (const inv of (invRows as any[]) ?? []) balById.set(inv.id as string, Number(inv.balance) || 0);
    }
    for (const l of links) {
      const bal = balById.get(l.invoice_id as string) ?? 0;
      liveLinkedBalanceByPromiseId.set(
        l.promise_id as string,
        (liveLinkedBalanceByPromiseId.get(l.promise_id as string) ?? 0) + bal,
      );
    }
  }

  const promisesInput: PromiseInput[] = rawPromises.map((r) => {
    const c = custById.get(r.customer_id);
    return {
      promiseId: r.id,
      caseId: r.case_id,
      customerId: r.customer_id,
      customerName: c?.name ?? "(unknown customer)",
      ownerId: c?.owner ?? null,
      status: r.status,
      promisedAmount: Number(r.promised_amount) || 0,
      amountReceived: Number(r.amount_received) || 0,
      baselineBalance: Number(r.baseline_balance) || 0,
      promisedDate: r.promised_date,
      graceUntil: r.grace_until,
      createdAt: r.created_at,
    };
  });

  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const allRows = buildPromiseRows(promisesInput, today, ownerLabels, {
    liveLinkedBalanceByPromiseId,
    openCaseIds,
  });
  const metrics = computePromiseMetrics(allRows, today, config);
  const counts = Object.fromEntries(
    PROMISE_TABS.map((t) => [t, applyPromiseTab(allRows, t, today, config).length]),
  ) as Record<PromiseTab, number>;
  const rows = sortPromiseRows(applyPromiseTab(allRows, tab, today, config), sort);

  // --- Selected promise: linked invoices + originating note ---
  const selected = promiseId ? (allRows.find((r) => r.promiseId === promiseId) ?? null) : null;
  let selectedInvoices: PromiseLinkedInvoice[] = [];
  let selectedNote: string | null = null;
  if (selected) {
    const { data: piRows } = await supabase
      .from("promise_invoices")
      .select("invoice_id")
      .eq("org_id", org.org_id)
      .eq("promise_id", selected.promiseId);
    const invIds = ((piRows as any[]) ?? []).map((r) => r.invoice_id as string);
    let invById = new Map<string, any>();
    if (invIds.length > 0) {
      const { data: invRows } = await supabase
        .from("invoices")
        .select("id, qbo_doc_number, balance")
        .eq("org_id", org.org_id)
        .in("id", invIds);
      invById = new Map(((invRows as any[]) ?? []).map((r) => [r.id, r]));
    }
    selectedInvoices = invIds.map((id) => ({
      invoiceId: id,
      docNumber: invById.get(id)?.qbo_doc_number ?? null,
      balance: Number(invById.get(id)?.balance ?? 0),
    }));

    const contactLogId = rawPromises.find((r) => r.id === selected.promiseId)?.contact_log_id ?? null;
    if (contactLogId) {
      const { data: log } = await supabase
        .from("contact_logs").select("notes").eq("org_id", org.org_id).eq("id", contactLogId).maybeSingle();
      selectedNote = (log as any)?.notes ?? null;
    }
  }

  return data(
    {
      orgName,
      initials, syncLabel, connected, isOwner,
      rows, metrics, counts, tab, sort,
      selected, selectedInvoices, selectedNote,
    },
    { headers },
  );
}

export default function Promises() {
  const d = useLoaderData<typeof loader>();
  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="promises"
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <PromisesMetrics metrics={d.metrics} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <PromisesLedger
            rows={d.rows}
            tab={d.tab}
            sort={d.sort}
            counts={d.counts}
            selectedId={d.selected?.promiseId ?? null}
          />
          <PromiseQuickPanel
            promise={d.selected}
            invoices={d.selectedInvoices}
            note={d.selectedNote}
          />
        </div>
      </div>
    </AppShell>
  );
}
