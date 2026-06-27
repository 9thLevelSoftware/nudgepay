import { useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
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
import { AppShell } from "../components/AppShell";
import { AccountsMetrics } from "../components/AccountsMetrics";
import { AccountsDirectory } from "../components/AccountsDirectory";
import { AccountQuickPanel } from "../components/AccountQuickPanel";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  // --- Prelude: mirrors dashboard.tsx exactly ---
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  // Org name
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", org.org_id)
    .single();

  // User initials from email
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials =
    emailParts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  // Connection status — service client only (no RLS needed for own org's connection)
  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";
  if (!connected) throw redirect("/settings", { headers });

  // Sync label from last_sync_at (connected is guaranteed true here — redirect above)
  const { data: connMeta } = await service
    .from("qbo_connections")
    .select("last_sync_at")
    .eq("org_id", org.org_id)
    .maybeSingle();
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
  let syncLabel: string;
  if (lastSyncAt) {
    const diffMs = Date.now() - new Date(lastSyncAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 2) syncLabel = "Synced just now";
    else if (diffMin < 60) syncLabel = `Synced ${diffMin}m ago`;
    else if (diffHr < 24) syncLabel = `Synced ${diffHr}h ago`;
    else syncLabel = `Synced ${diffDay}d ago`;
  } else {
    syncLabel = "Connected";
  }

  const isOwner = org.role === "owner";

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

  const today = new Date().toISOString().slice(0, 10);

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
    .select("case_id, created_at")
    .eq("org_id", org.org_id)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false });
  for (const r of (msgRows as any[]) ?? []) {
    if (!r.case_id) continue;
    const cid = caseToCustomer.get(r.case_id as string);
    if (!cid) continue; // unmapped case — skip
    lastContactsInput.push({ customerId: cid, date: r.created_at, channel: "Text" });
  }

  // Owner labels
  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  // --- Build rows ---
  const allRows = buildAccountRows(
    customersInput,
    invoicesInput,
    activeCases,
    lastContactsInput,
    today,
    ownerLabels,
  );
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
      orgName: orgRow?.name ?? "(unknown)",
      initials,
      syncLabel,
      connected,
      isOwner,
      rows,
      metrics,
      counts,
      filter,
      sort,
      q,
      selected,
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
      syncLabel={d.syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="accounts"
    >
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <AccountsMetrics metrics={d.metrics} />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <AccountsDirectory
            rows={d.rows}
            filter={d.filter}
            sort={d.sort}
            search={d.q}
            counts={d.counts}
            selectedId={d.selected?.customerId ?? null}
          />
          <AccountQuickPanel account={d.selected} />
        </div>
      </div>
    </AppShell>
  );
}
