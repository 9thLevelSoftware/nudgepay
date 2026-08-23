import { useEffect, useState } from "react";
import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { todayInTz } from "../lib/tz";
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
  type DayConfig,
} from "../lib/promise-ledger";
import { AppShell } from "../components/AppShell";
import { SyncIssues } from "../components/SyncIssues";
import { PromisesMetrics } from "../components/PromisesMetrics";
import { PromisesLedger } from "../components/PromisesLedger";
import { PromiseQuickPanel } from "../components/PromiseQuickPanel";
import { DrawerShell } from "../components/DrawerShell";
import { pageTitle } from "../lib/meta";
import { chunkIds, honestListState, orderPage, pageAllChunkedHonest, pageAllHonest, PAGE_ALL_MAX_ROWS } from "../lib/page-all";
import { LoadErrorBanner, TruncationBanner } from "../components/TruncationBanner";
import type { Route } from "./+types/promises";

export const meta: Route.MetaFunction = () => pageTitle("Promises");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, service, headers, isOwner, org,
    orgName, initials, userLabel, connected, syncLabel,
    syncIssues,
  } = await loadWorkspaceChrome(request, env);

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
  const promiseError = sp.get("promiseError");
  const q = (sp.get("q") ?? "").trim();
  const returnQs = new URLSearchParams({ tab, sort });
  if (promiseId) returnQs.set("promiseId", promiseId);
  if (q) returnQs.set("q", q);
  const returnTo = `/promises?${returnQs.toString()}`;

  // --- Org config for the due-soon business-day window + org-local "today" ---
  const orgConfig = await loadOrgConfig(supabase, org.org_id);
  const today = todayInTz(orgConfig.companyProfile.timezone);
  const config: DayConfig = {
    workingDays: orgConfig.workingDays,
    holidays: orgConfig.holidays,
    dueSoonBusinessDays: orgConfig.workflow.dueSoonBusinessDays,
  };

  // --- Data loading (USER client, explicit org_id scope) ---
  type PromiseDbRow = {
    id: string; case_id: string; customer_id: string; status: PromiseInput["status"];
    promised_amount: number | string | null; amount_received: number | string | null;
    baseline_balance: number | string | null; promised_date: string; grace_until: string;
    created_at: string; contact_log_id: string | null;
  };
  const promisePage = await pageAllHonest<PromiseDbRow>(
    (from, to) =>
      orderPage(
        supabase
          .from("promises")
          .select("id, case_id, customer_id, status, promised_amount, amount_received, baseline_balance, promised_date, grace_until, created_at, contact_log_id", { count: "exact" })
          .eq("org_id", org.org_id),
      ).range(from, to),
    { maxRows: PAGE_ALL_MAX_ROWS },
  );
  const rawPromises = promisePage.rows;

  const customerIds = Array.from(new Set(rawPromises.map((r) => r.customer_id)));
  const caseIds = Array.from(new Set(rawPromises.map((r) => r.case_id)));
  const pendingIds = rawPromises.filter((r) => r.status === "pending").map((r) => r.id);

  type CustRow = { id: string; name: string | null; owner: string | null };
  type CaseLookupRow = { id: string; closed_at: string | null };
  type PiRow = { promise_id: string; invoice_id: string };
  const [custPage, casePage, piPage] = await Promise.all([
    customerIds.length === 0
      ? Promise.resolve({ rows: [] as CustRow[], truncated: false, error: null })
      : pageAllChunkedHonest<CustRow>(
          chunkIds(customerIds, 100),
          (ids, from, to) =>
            orderPage(
              supabase
                .from("customers")
                .select("id, name, owner", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("id", ids),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
    caseIds.length === 0
      ? Promise.resolve({ rows: [] as CaseLookupRow[], truncated: false, error: null })
      : pageAllChunkedHonest<CaseLookupRow>(
          chunkIds(caseIds, 100),
          (ids, from, to) =>
            orderPage(
              supabase
                .from("collection_cases")
                .select("id, closed_at", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("id", ids),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
    pendingIds.length === 0
      ? Promise.resolve({ rows: [] as PiRow[], truncated: false, error: null })
      : pageAllChunkedHonest<PiRow>(
          chunkIds(pendingIds, 100),
          (ids, from, to) =>
            supabase
              .from("promise_invoices")
              .select("promise_id, invoice_id", { count: "exact" })
              .eq("org_id", org.org_id)
              .in("promise_id", ids)
              .order("promise_id", { ascending: false })
              .order("invoice_id", { ascending: false })
              .range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        ),
  ]);
  const custById = new Map(custPage.rows.map((c) => [c.id, c]));
  const openCaseIds = new Set(
    casePage.rows.filter((c) => c.closed_at == null).map((c) => c.id),
  );

  const liveLinkedBalanceByPromiseId = new Map<string, number>();
  const linkInvIds = Array.from(new Set(piPage.rows.map((l) => l.invoice_id)));
  type BalRow = { id: string; balance: number | string | null };
  const invBalPage = linkInvIds.length === 0
    ? { rows: [] as BalRow[], truncated: false, error: null }
    : await pageAllChunkedHonest<BalRow>(
        chunkIds(linkInvIds, 100),
        (ids, from, to) =>
          orderPage(
            supabase
              .from("invoices")
              .select("id, balance", { count: "exact" })
              .eq("org_id", org.org_id)
              .in("id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      );
  const balById = new Map<string, number>();
  for (const inv of invBalPage.rows) balById.set(inv.id, Number(inv.balance) || 0);
  for (const l of piPage.rows) {
    const bal = balById.get(l.invoice_id) ?? 0;
    liveLinkedBalanceByPromiseId.set(
      l.promise_id,
      (liveLinkedBalanceByPromiseId.get(l.promise_id) ?? 0) + bal,
    );
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
  // Search narrows the whole ledger (counts + rows), matching the Accounts
  // directory's behaviour. Case-insensitive substring on the customer name.
  const needle = q.toLowerCase();
  const searched = needle
    ? allRows.filter((r) => r.customerName.toLowerCase().includes(needle))
    : allRows;
  const metrics = computePromiseMetrics(allRows, today, config);
  const counts = Object.fromEntries(
    PROMISE_TABS.map((t) => [t, applyPromiseTab(searched, t, today, config).length]),
  ) as Record<PromiseTab, number>;
  const rows = sortPromiseRows(applyPromiseTab(searched, tab, today, config), sort);

  // --- Selected promise: linked invoices + originating note ---
  const selected = promiseId ? (allRows.find((r) => r.promiseId === promiseId) ?? null) : null;
  let selectedInvoices: PromiseLinkedInvoice[] = [];
  let selectedNote: string | null = null;
  let selectedTruncated = false;
  let selectedError: { message: string } | null = null;
  let invoiceDetailFailed = false;
  if (selected) {
    const selectedPi = await pageAllHonest<{ invoice_id: string }>(
      (from, to) =>
        supabase
          .from("promise_invoices")
          .select("invoice_id", { count: "exact" })
          .eq("org_id", org.org_id)
          .eq("promise_id", selected.promiseId)
          .order("invoice_id", { ascending: false })
          .range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    );
    selectedTruncated = selectedPi.truncated;
    const invIds = selectedPi.rows.map((r) => r.invoice_id);
    type SelInv = { id: string; qbo_doc_number: string | null; balance: number | string | null };
    const selInvPage = invIds.length === 0
      ? { rows: [] as SelInv[], truncated: false, error: null }
      : await pageAllChunkedHonest<SelInv>(
          chunkIds(invIds, 100),
          (ids, from, to) =>
            orderPage(
              supabase
                .from("invoices")
                .select("id, qbo_doc_number, balance", { count: "exact" })
                .eq("org_id", org.org_id)
                .in("id", ids),
            ).range(from, to),
          { maxRows: PAGE_ALL_MAX_ROWS },
        );
    selectedTruncated = selectedTruncated || selInvPage.truncated;
    invoiceDetailFailed = !!(selectedPi.error || selInvPage.error);
    selectedError = selectedPi.error ?? selInvPage.error;
    const invById = new Map(selInvPage.rows.map((r) => [r.id, r]));
    selectedInvoices = invIds.map((id) => ({
      invoiceId: id,
      docNumber: invById.get(id)?.qbo_doc_number ?? null,
      balance: Number(invById.get(id)?.balance ?? 0),
    }));

    const contactLogId = rawPromises.find((r) => r.id === selected.promiseId)?.contact_log_id ?? null;
    if (contactLogId) {
      const { data: log, error: logErr } = await supabase
        .from("contact_logs").select("notes").eq("org_id", org.org_id).eq("id", contactLogId).maybeSingle();
      if (logErr) {
        selectedError = selectedError ?? { message: logErr.message };
      } else {
        selectedNote = (log as { notes?: string | null } | null)?.notes ?? null;
      }
    }
  }

  const listState = honestListState([promisePage, custPage, casePage, piPage, invBalPage]);
  const loadError = listState.loadError ? "Could not load promises" : null;
  const truncated = listState.truncated;
  const selectedLoadError = selectedError ? "Could not load promise detail" : null;

  return data(
    {
      orgName,
      initials, userLabel, syncLabel, connected, isOwner, syncIssues,
      rows: loadError ? [] : rows,
      metrics, counts, tab, sort, q, returnTo,
      selected: loadError ? null : selected,
      selectedInvoices: loadError || invoiceDetailFailed ? [] : selectedInvoices,
      selectedNote: loadError || selectedLoadError ? null : selectedNote,
      promiseError,
      truncated,
      loadError,
      selectedLoadError,
      selectedTruncated,
    },
    { headers },
  );
}

export default function Promises() {
  const d = useLoaderData<typeof loader>();
  useFlashCleanup();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const quickPanel = (
    <PromiseQuickPanel
      promise={d.selected}
      invoices={d.selectedInvoices}
      note={d.selectedNote}
      returnTo={d.returnTo}
      promiseError={d.promiseError}
      loadError={d.selectedLoadError}
      truncated={d.selectedTruncated}
    />
  );
  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      userLabel={d.userLabel}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="promises"
      syncIssues={<SyncIssues issues={d.syncIssues} returnTo="/promises" />}
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {d.loadError ? <LoadErrorBanner message={d.loadError} /> : d.truncated ? <TruncationBanner /> : null}
        <PromisesMetrics metrics={d.metrics} truncated={d.truncated || !!d.loadError} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <PromisesLedger
            rows={d.rows}
            tab={d.tab}
            sort={d.sort}
            search={d.q}
            counts={d.counts}
            selectedId={d.selected?.promiseId ?? null}
            loadError={d.loadError}
            truncated={d.truncated}
          />
          <div className="hidden lg:block">{isDesktop ? quickPanel : null}</div>
        </div>
        {/* Below lg the selection opens as a drawer — no dead-end at the page bottom */}
        {d.selected && !isDesktop ? (
          <div className="lg:hidden">
            <DrawerShell
              label={`Promise — ${d.selected.customerName}`}
              closeHref={d.returnTo.replace(/[?&]promiseId=[^&]*/, "").replace(/\?$/, "")}
              maxWidth="max-w-[420px]"
            >
              {quickPanel}
            </DrawerShell>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
