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
import { loadReplySource, peekWindowStartIso } from "../lib/activity-peek.server";
import { loadPayerSource } from "../lib/payer-behavior.server";
import { parseAccountsDensity } from "../lib/queue-chrome";
import { AppShell } from "../components/AppShell";
import { SyncIssues } from "../components/SyncIssues";
import { AccountsMetrics } from "../components/AccountsMetrics";
import { AccountsDirectory } from "../components/AccountsDirectory";
import { AccountQuickPanel } from "../components/AccountQuickPanel";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/accounts";

export const meta: Route.MetaFunction = () => pageTitle("Accounts");

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

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

  // All customers
  const { data: custRows } = await supabase
    .from("customers")
    .select("id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text")
    .eq("org_id", org.org_id);
  const customersInput: CustomerInput[] = ((custRows as any[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name ?? "(unknown customer)",
    phone: r.phone ?? null,
    email: r.email ?? null,
    owner: r.owner ?? null,
    smsConsent: r.sms_consent ?? false,
    commPrefs: resolveCommPrefs(r),
  }));

  // Open invoices (balance > 0)
  const { data: invRows } = await supabase
    .from("invoices")
    .select("id, qbo_doc_number, customer_id, balance, due_date")
    .eq("org_id", org.org_id)
    .gt("balance", 0);
  const invoicesInput: InvoiceInput[] = ((invRows as any[]) ?? []).map((r) => ({
    id: r.id,
    qbo_doc_number: r.qbo_doc_number ?? null,
    customer_id: r.customer_id ?? null,
    balance: Number(r.balance ?? 0),
    due_date: r.due_date ?? null,
  }));

  // All collection_cases (open + closed — needed for caseToCustomer map)
  const { data: caseRows } = await supabase
    .from("collection_cases")
    .select("id, customer_id, status, exception_reason, next_action_at, closed_at")
    .eq("org_id", org.org_id);
  const allCaseRows = (caseRows as any[]) ?? [];

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

  const { data: logRows } = await supabase
    .from("contact_logs")
    .select("customer_id, created_at, method")
    .eq("org_id", org.org_id)
    .not("customer_id", "is", null)
    .order("created_at", { ascending: false });
  const methodLabel: Record<string, string> = { call: "Call", email: "Email", text: "Text", note: "Note" };
  for (const r of (logRows as any[]) ?? []) {
    if (r.customer_id) {
      lastContactsInput.push({
        customerId: r.customer_id,
        date: r.created_at,
        channel: methodLabel[r.method as string] ?? "Note",
      });
    }
  }

  const { data: msgRows } = await supabase
    .from("text_messages")
    .select("case_id, customer_id, created_at")
    .eq("org_id", org.org_id)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false });
  for (const r of (msgRows as any[]) ?? []) {
    const cid = (r.customer_id as string | null)
      ?? (r.case_id ? caseToCustomer.get(r.case_id as string) : undefined);
    if (!cid) continue;
    lastContactsInput.push({ customerId: cid, date: r.created_at, channel: "Text" });
  }

  const { data: emailRows } = await supabase
    .from("email_messages")
    .select("case_id, customer_id, created_at")
    .eq("org_id", org.org_id)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false });
  for (const r of (emailRows as any[]) ?? []) {
    const cid = (r.customer_id as string | null)
      ?? (r.case_id ? caseToCustomer.get(r.case_id as string) : undefined);
    if (!cid) continue;
    lastContactsInput.push({ customerId: cid, date: r.created_at, channel: "Email" });
  }

  // Owner labels
  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  const customerIds = customersInput.map((c) => c.id);
  const brokenPromiseByCustomer = new Map<string, boolean>();
  const { data: brokenProms } = await supabase
    .from("promises")
    .select("case_id")
    .eq("org_id", org.org_id)
    .eq("status", "broken");
  for (const r of (brokenProms as { case_id: string | null }[] | null) ?? []) {
    const cid = r.case_id ? caseToCustomer.get(r.case_id) : undefined;
    if (cid) brokenPromiseByCustomer.set(cid, true);
  }
  const replySrc = await loadReplySource({
    supabase,
    orgId: org.org_id,
    customerIds,
    windowStartIso: peekWindowStartIso(today),
  });
  const payerByCustomer = await loadPayerSource({
    supabase,
    orgId: org.org_id,
    customerIds,
    today,
    brokenPromiseByCustomer,
    replyByCustomer: replySrc.replyByCustomer,
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
      initials,
      userLabel,
      syncLabel,
      connected,
      isOwner,
      syncIssues,
      rows,
      metrics,
      counts,
      filter,
      sort,
      q,
      density,
      densityFromUrl,
      selected,
      timeZone: orgConfig.companyProfile.timezone,
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
      userInitials={d.initials}
      userLabel={d.userLabel}
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="accounts"
      syncIssues={<SyncIssues issues={d.syncIssues} returnTo="/accounts" />}
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <AccountsMetrics metrics={d.metrics} />
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
          />
          <AccountQuickPanel account={d.selected} />
        </div>
      </div>
    </AppShell>
  );
}
