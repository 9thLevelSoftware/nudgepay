import { useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { AppShell } from "../components/AppShell";
import { AccountProfile } from "../components/AccountProfile";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
import { buildTimeline, type TimelineLogInput, type TimelineSmsInput } from "../lib/timeline";
import { resolveCommPrefs } from "../lib/comm-prefs";
import { isCaseSuppressed, type ExceptionState } from "../lib/exceptions";
import { ageInDays } from "../lib/worklist";
import { deriveStanding } from "../lib/accounts";
import { pageTitle } from "../lib/meta";
import { displayLabel, initialsFrom } from "../lib/names";
import type { Route } from "./+types/accounts.$id";

export const meta: Route.MetaFunction = ({ data }) =>
  pageTitle(data?.account?.name ? `${data.account.name} — Account` : "Account");

// ---------------------------------------------------------------------------
// Local DB row shapes (no generated types — mirror the SELECT columns)
// ---------------------------------------------------------------------------

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  owner: string | null;
  sms_consent: boolean | null;
  preferred_channel: string | null;
  do_not_call: boolean | null;
  do_not_text: boolean | null;
  notes: string | null;
};

type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  amount: number | string | null;
  balance: number | string | null;
  due_date: string | null;
  status: string | null;
};

type CaseRow = {
  id: string;
  closed_at: string | null;
  status: string;
  exception_reason: string | null;
  next_action_at: string | null;
};

type ContactLogRow = {
  id: string;
  created_at: string;
  method: string;
  outcome: string | null;
  notes: string | null;
  follow_up_at: string | null;
  promised_amount: number | string | null;
  promised_date: string | null;
};

type TextMessageRow = {
  id: string;
  created_at: string;
  direction: string;
  body: string | null;
  status: string | null;
  error_code: string | null;
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  // --- Prelude: mirrors accounts.tsx / dashboard.tsx verbatim ---
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

  // User initials from display name or email
  const userLabel = displayLabel(user.user_metadata?.display_name, user.email, user.id);
  const initials = initialsFrom(userLabel);

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
  const today = new Date().toISOString().slice(0, 10);
  const customerId = params.id as string;

  // ---------------------------------------------------------------------------
  // Customer (USER client, org-scoped + id-scoped)
  // ---------------------------------------------------------------------------

  const { data: custData } = await supabase
    .from("customers")
    .select(
      "id, name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text, notes",
    )
    .eq("org_id", org.org_id)
    .eq("id", customerId)
    .maybeSingle();

  const customerRow = custData as CustomerRow | null;
  if (!customerRow) throw new Response("Account not found", { status: 404, headers });

  // ---------------------------------------------------------------------------
  // Invoices — ALL (paid + open), newest-due-date first
  // ---------------------------------------------------------------------------

  const { data: invData } = await supabase
    .from("invoices")
    .select("id, qbo_doc_number, amount, balance, due_date, status")
    .eq("org_id", org.org_id)
    .eq("customer_id", customerId)
    .order("due_date", { ascending: false });

  const rawInvoices = ((invData as unknown as InvoiceRow[]) ?? []);

  // Aggregates — computed here so Task 11's component stays presentational
  const openBalance = rawInvoices.reduce((sum, r) => {
    const bal = Number(r.balance ?? 0);
    return bal > 0 ? sum + bal : sum;
  }, 0);
  const openInvoiceCount = rawInvoices.filter((r) => Number(r.balance ?? 0) > 0).length;
  const oldestOverdueDays = rawInvoices.reduce((max, r) => {
    const bal = Number(r.balance ?? 0);
    if (bal <= 0 || !r.due_date) return max;
    const age = ageInDays(r.due_date, today);
    return age > 0 ? Math.max(max, age) : max;
  }, 0);
  const lifetimeInvoiced = rawInvoices.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const invoices = rawInvoices.map((r) => ({
    id: r.id,
    docNumber: r.qbo_doc_number,
    amount: Number(r.amount ?? 0),
    balance: Number(r.balance ?? 0),
    dueDate: r.due_date,
    status: r.status,
  }));

  // ---------------------------------------------------------------------------
  // Customer's collection cases (org-scoped + customer-scoped)
  // ---------------------------------------------------------------------------

  const { data: caseData } = await supabase
    .from("collection_cases")
    .select("id, closed_at, status, exception_reason, next_action_at")
    .eq("org_id", org.org_id)
    .eq("customer_id", customerId);

  const allCaseRows = ((caseData as unknown as CaseRow[]) ?? []);
  const caseIds: string[] = allCaseRows.map((r) => r.id);

  // Active case = first row with closed_at == null
  const activeCaseRow = allCaseRows.find((r) => r.closed_at == null) ?? null;
  const activeCaseId: string | null = activeCaseRow?.id ?? null;

  const onHold = activeCaseRow
    ? isCaseSuppressed({
        status: activeCaseRow.status,
        exceptionReason: (activeCaseRow.exception_reason as ExceptionState | null) ?? null,
        nextActionAt: activeCaseRow.next_action_at,
        today,
      })
    : false;

  // ---------------------------------------------------------------------------
  // Roster (service client — reads auth.users; needed for timeline author labels
  // and owner assignment UIs)
  // ---------------------------------------------------------------------------

  const roster = await listOrgMembers(service, org.org_id);
  const ownerLabels = new Map(roster.map((m) => [m.userId, m.label]));

  // ---------------------------------------------------------------------------
  // Timeline logs — customer-scoped (all logs across all cases for this customer)
  // ---------------------------------------------------------------------------

  const { data: logData } = await supabase
    .from("contact_logs")
    .select(
      "id, user_id, created_at, method, outcome, notes, follow_up_at, promised_amount, promised_date",
    )
    .eq("org_id", org.org_id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  const logInputs: TimelineLogInput[] = ((logData as unknown as (ContactLogRow & { user_id: string | null })[]) ?? []).map(
    (r) => ({
      id: r.id,
      at: r.created_at,
      method: r.method,
      outcome: r.outcome,
      notes: r.notes,
      followUpAt: r.follow_up_at,
      promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount) || null,
      promisedDate: r.promised_date,
      authorLabel: r.user_id ? (ownerLabels.get(r.user_id) ?? null) : null,
    }),
  );

  // ---------------------------------------------------------------------------
  // Timeline SMS — case-scoped (all SMS across all of the customer's cases)
  // ---------------------------------------------------------------------------

  // Account-wide SMS: text_messages carry customer_id on every send + inbound
  // (since 0006), so scope by customer_id to include a paid-up/resolved customer's
  // caseless replies (case_id null). Also union case-scoped rows so any legacy
  // row predating customer_id still surfaces. org_id is ANDed with the OR group.
  let smsInputs: TimelineSmsInput[] = [];
  {
    let smsQuery = supabase
      .from("text_messages")
      .select("id, created_at, direction, body, status, error_code")
      .eq("org_id", org.org_id);
    smsQuery = caseIds.length > 0
      ? smsQuery.or(`customer_id.eq.${params.id},case_id.in.(${caseIds.join(",")})`)
      : smsQuery.eq("customer_id", params.id);
    const { data: smsData } = await smsQuery;

    smsInputs = ((smsData as unknown as TextMessageRow[]) ?? []).map((r) => ({
      id: r.id,
      at: r.created_at,
      direction: r.direction,
      body: r.body,
      status: r.status,
      errorCode: r.error_code,
    }));
  }

  const timeline = buildTimeline(logInputs, smsInputs);

  // ---------------------------------------------------------------------------
  // Derived fields
  // ---------------------------------------------------------------------------

  const commPrefs = resolveCommPrefs(customerRow);
  const ownerLabel = customerRow.owner
    ? (ownerLabels.get(customerRow.owner) ?? "Unknown")
    : "Unassigned";
  const standing = deriveStanding({ openBalance, hasActiveCase: activeCaseId != null, onHold });
  const returnTo = `/accounts/${customerId}`;

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      initials,
      syncLabel,
      connected,
      isOwner,
      account: {
        id: customerRow.id,
        name: customerRow.name ?? "(unknown)",
        phone: customerRow.phone,
        email: customerRow.email,
        ownerId: customerRow.owner,
        ownerLabel,
        smsConsent: customerRow.sms_consent ?? false,
        doNotCall: customerRow.do_not_call ?? false,
        doNotText: customerRow.do_not_text ?? false,
        commPrefs,
        notes: customerRow.notes,
        standing,
        openBalance,
        openInvoiceCount,
        oldestOverdueDays,
        lifetimeInvoiced,
        activeCaseId,
        onHold,
      },
      invoices,
      timeline,
      roster,
      activeCaseId,
      returnTo,
    },
    { headers },
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AccountProfilePage() {
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
      <AccountProfile
        customerId={d.account.id}
        name={d.account.name}
        standing={d.account.standing}
        owner={d.account.ownerLabel}
        ownerId={d.account.ownerId}
        email={d.account.email}
        phone={d.account.phone}
        smsConsent={d.account.smsConsent}
        commPrefs={d.account.commPrefs}
        notes={d.account.notes}
        openBalance={d.account.openBalance}
        openInvoiceCount={d.account.openInvoiceCount}
        oldestOverdueDays={d.account.oldestOverdueDays}
        lifetimeInvoiced={d.account.lifetimeInvoiced}
        invoices={d.invoices}
        timeline={d.timeline}
        roster={d.roster}
        activeCaseId={d.activeCaseId}
        returnTo={d.returnTo}
      />
    </AppShell>
  );
}
