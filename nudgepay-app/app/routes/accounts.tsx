import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { todayInTz } from "../lib/tz";
import { isCaseSuppressed, type ExceptionState } from "../lib/exceptions";
import { resolveCommPrefs } from "../lib/comm-prefs";
import {
  buildAccountRows,
  applyAccountFilter,
  sortAccountRows,
  computeAccountMetrics,
  ACCOUNT_FILTERS,
  ACCOUNT_SORTS,
  type AccountFilter,
  type AccountSort,
  type AccountCaseInput,
  type AccountLastContactInput,
} from "../lib/accounts";
import type { CustomerInput, InvoiceInput } from "../lib/worklist";
import { PEEK_WINDOW_DAYS } from "../lib/activity-peek";
import { loadReplySource, peekWindowStartIso } from "../lib/activity-peek.server";
import { loadBrokenPromiseCustomers, loadPayerSource } from "../lib/payer-behavior.server";
import { parseAccountsDensity, accountsHref } from "../lib/queue-chrome";
import { AppShell } from "../components/AppShell";
import { SyncIssues } from "../components/SyncIssues";
import { AccountsMetrics } from "../components/AccountsMetrics";
import { AccountsDirectory } from "../components/AccountsDirectory";
import { AccountQuickPanel } from "../components/AccountQuickPanel";
import { DrawerShell } from "../components/DrawerShell";
import { pageTitle } from "../lib/meta";
import { honestListState, orderPage, pageAllHonest, PAGE_ALL_MAX_ROWS } from "../lib/page-all";
import { LoadErrorBanner, TruncationBanner } from "../components/TruncationBanner";
import type { Route } from "./+types/accounts";

export const meta: Route.MetaFunction = () => pageTitle("Accounts");

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, service, headers, isOwner, isAdmin, org,
    orgName, initials, userLabel, connected, syncLabel,
    syncIssues, workspaces,
  } = await loadWorkspaceChrome(request, env);

  // --- URL params ---
  const url = new URL(request.url);
  const sp = url.searchParams;
  const filter: AccountFilter = (ACCOUNT_FILTERS as string[]).includes(sp.get("filter") ?? "")
    ? (sp.get("filter") as AccountFilter)
    : "all";
  const sort: AccountSort = (ACCOUNT_SORTS as string[]).includes(sp.get("sort") ?? "")
    ? (sp.get("sort") as AccountSort)
    : "name";
  const q = sp.get("q") ?? "";
  const customerId = sp.get("customerId");
  const densityRaw = sp.get("density");
  const densityFromUrl = densityRaw != null;
  const density = parseAccountsDensity(densityRaw);

  const orgConfig = await loadOrgConfig(supabase, org.org_id);
  const today = todayInTz(orgConfig.companyProfile.timezone);

  // --- Data loading (USER client, explicit org_id scope) ---

  type CustRow = {
    id: string; name: string | null; phone: string | null; email: string | null; owner: string | null;
    sms_consent: boolean | null; preferred_channel: string | null; do_not_call: boolean | null; do_not_text: boolean | null;
  };
  type InvRow = {
    id: string; qbo_doc_number: string | null; customer_id: string | null; balance: number | string | null;
    due_date: string | null; amount: number | string | null; invoice_date: string | null; status: string | null; paid_date: string | null;
  };
  type CaseDbRow = {
    id: string; customer_id: string; status: string; exception_reason: string | null;
    next_action_at: string | null; closed_at: string | null;
  };
  const [custPage, invPage, casePage] = await Promise.all([
    pageAllHonest<CustRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("customers")
            .select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text", { count: "exact" })
            .eq("org_id", org.org_id),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<InvRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("invoices")
            .select("id, qbo_doc_number, customer_id, balance, due_date, amount, invoice_date, status, paid_date", { count: "exact" })
            .eq("org_id", org.org_id)
            .gt("balance", 0),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<CaseDbRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("collection_cases")
            .select("id, customer_id, status, exception_reason, next_action_at, closed_at", { count: "exact" })
            .eq("org_id", org.org_id),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);
  const customersInput: CustomerInput[] = custPage.rows.map((r) => ({
    id: r.id,
    name: r.name ?? "(unknown customer)",
    phone: r.phone ?? null,
    email: r.email ?? null,
    owner: r.owner ?? null,
    smsConsent: r.sms_consent ?? false,
    commPrefs: resolveCommPrefs(r),
  }));
  const invoicesInput: InvoiceInput[] = invPage.rows.map((r) => ({
    id: r.id,
    qbo_doc_number: r.qbo_doc_number ?? null,
    customer_id: r.customer_id ?? null,
    balance: Number(r.balance ?? 0),
    due_date: r.due_date ?? null,
    amount: Number(r.amount ?? 0),
    invoice_date: r.invoice_date ?? null,
    status: r.status ?? null,
    paid_date: r.paid_date ?? null,
  }));
  const allCaseRows = casePage.rows;

  // activeCases: open rows only (closed_at == null)
  const activeCases: AccountCaseInput[] = allCaseRows
    .filter((r) => r.closed_at == null)
    .map((r) => ({
      customerId: r.customer_id as string,
      onHold: isCaseSuppressed({
        status: r.status,
        exceptionReason: (r.exception_reason as ExceptionState | null) ?? null,
        nextActionAt: r.next_action_at ?? null,
        today,
      }),
    }));

  // caseToCustomer: ALL rows (for text_messages join)
  const caseToCustomer = new Map<string, string>(
    allCaseRows.map((r) => [r.id as string, r.customer_id as string]),
  );

  // Last contact per customer: contact_logs + outbound text_messages
  const lastContactsInput: AccountLastContactInput[] = [];
  type ContactRow = { customer_id: string | null; created_at: string; method: string | null };
  type OutboundRow = { case_id: string | null; customer_id: string | null; created_at: string };
  const [logPage, msgPage, emailPage] = await Promise.all([
    pageAllHonest<ContactRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("contact_logs")
            .select("customer_id, created_at, method", { count: "exact" })
            .eq("org_id", org.org_id)
            .not("customer_id", "is", null),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<OutboundRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("text_messages")
            .select("case_id, customer_id, created_at", { count: "exact" })
            .eq("org_id", org.org_id)
            .eq("direction", "outbound"),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
    pageAllHonest<OutboundRow>(
      (from, to) =>
        orderPage(
          supabase
            .from("email_messages")
            .select("case_id, customer_id, created_at", { count: "exact" })
            .eq("org_id", org.org_id)
            .eq("direction", "outbound"),
        ).range(from, to),
      { maxRows: PAGE_ALL_MAX_ROWS },
    ),
  ]);
  const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
  for (const r of logPage.rows) {
    if (r.customer_id) {
      lastContactsInput.push({
        customerId: r.customer_id,
        date: r.created_at,
        channel: methodLabel[r.method ?? ""] ?? "Note",
      });
    }
  }
  for (const r of msgPage.rows) {
    const cid = r.customer_id ?? (r.case_id ? caseToCustomer.get(r.case_id) : undefined);
    if (!cid) continue;
    lastContactsInput.push({ customerId: cid, date: r.created_at, channel: "Text" });
  }
  for (const r of emailPage.rows) {
    const cid = r.customer_id ?? (r.case_id ? caseToCustomer.get(r.case_id) : undefined);
    if (!cid) continue;
    lastContactsInput.push({ customerId: cid, date: r.created_at, channel: "Email" });
  }

  const listState = honestListState([custPage, invPage, casePage, logPage, msgPage, emailPage]);
  const loadError = listState.loadError ? "Could not load accounts" : null;
  const truncated = listState.truncated;

  // Owner labels
  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const customerIds = customersInput.map((c) => c.id);
  const tz = orgConfig.companyProfile.timezone;
  const [replySrc, brokenPromiseByCustomer] = await Promise.all([
    loadReplySource({
      supabase,
      orgId: org.org_id,
      customerIds,
      windowStartIso: peekWindowStartIso(today, PEEK_WINDOW_DAYS, tz),
    }),
    loadBrokenPromiseCustomers({ supabase, orgId: org.org_id, caseToCustomer }),
  ]);
  const payerByCustomer = await loadPayerSource({
    supabase,
    orgId: org.org_id,
    customerIds,
    today,
    brokenPromiseByCustomer,
    replyByCustomer: replySrc.replyByCustomer,
    replyTruncated: replySrc.truncated,
  });

  // --- Build rows ---
  const allRows = buildAccountRows(
    customersInput,
    invoicesInput,
    activeCases,
    lastContactsInput,
    today,
    ownerLabels,
  ).map((r) => ({ ...r, payer: payerByCustomer.get(r.customerId) ?? null }));
  const searched =
    q.trim() === "" ? allRows : allRows.filter((r) => r.searchText.includes(q.toLowerCase()));
  const metrics = computeAccountMetrics(searched);
  const counts = Object.fromEntries(
    ACCOUNT_FILTERS.map((f) => [f, applyAccountFilter(searched, f).length]),
  ) as Record<AccountFilter, number>;
  const rows = sortAccountRows(applyAccountFilter(searched, filter), sort);
  const selected = customerId ? (searched.find((r) => r.customerId === customerId) ?? null) : null;

  return data(
    {
      orgName,
      orgId: org.org_id,
      workspaces,
      initials,
      userLabel,
      syncLabel,
      connected,
      isOwner,
      isAdmin,
      syncIssues,
      rows: loadError ? [] : rows,
      metrics,
      counts,
      filter,
      sort,
      q,
      density,
      densityFromUrl,
      selected: loadError ? null : selected,
      timeZone: orgConfig.companyProfile.timezone,
      truncated,
      loadError,
    },
    { headers },
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function Accounts() {
  const d = useLoaderData<typeof loader>();
  return (
    <AppShell
      orgName={d.orgName}
      orgId={d.orgId}
      workspaces={d.workspaces}
      userInitials={d.initials}
      userLabel={d.userLabel}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      isAdmin={d.isAdmin}
      activeNav="accounts"
      syncIssues={<SyncIssues issues={d.syncIssues} returnTo="/accounts" />}
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {d.loadError ? <LoadErrorBanner message={d.loadError} /> : d.truncated ? <TruncationBanner /> : null}
        <AccountsMetrics metrics={d.metrics} truncated={d.truncated || !!d.loadError} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <AccountsDirectory
            rows={d.rows}
            filter={d.filter}
            sort={d.sort}
            search={d.q}
            density={d.density}
            densityFromUrl={d.densityFromUrl}
            counts={d.counts}
            selectedId={d.selected?.customerId ?? null}
            timeZone={d.timeZone}
            loadError={d.loadError}
            truncated={d.truncated}
          />
          <div className="hidden lg:block">
            <AccountQuickPanel account={d.selected} />
          </div>
        </div>
        {/* Below lg the selection opens as a drawer — no dead-end at the page bottom */}
        {d.selected ? (
          <div className="lg:hidden">
            <DrawerShell
              label={`Account — ${d.selected.name}`}
              closeHref={accountsHref({ filter: d.filter, sort: d.sort, q: d.q || undefined, density: d.densityFromUrl ? d.density : undefined })}
              maxWidth="max-w-[420px]"
            >
              <AccountQuickPanel account={d.selected} />
            </DrawerShell>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
