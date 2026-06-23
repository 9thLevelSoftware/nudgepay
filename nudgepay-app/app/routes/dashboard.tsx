import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
// worklist-pure.ts has no .server. suffix → safe for both client bundle and server.
// worklist.server.ts is the authoritative module but is server-only by naming convention;
// all value references inside the loader (which RR strips from the client bundle) use it.
// buildDashboardData is exported from this route (for tests) so it must only depend on
// the client-safe worklist-pure module.
import {
  buildWorkItems,
  applyView,
  sortItems,
  computeMetrics,
  type InvoiceInput,
  type CustomerInput,
  type LastContactInput,
  type WorkItem,
  type Metrics,
  type ViewId,
  type SortId,
} from "../lib/worklist-pure";
import { AppShell } from "../components/AppShell";
import { MetricsStrip } from "../components/MetricsStrip";
import { WorkQueue } from "../components/WorkQueue";
import { DetailPanel } from "../components/DetailPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardParams = {
  view: ViewId;
  sort: SortId;
  q: string;
  invoice: string | null;
  tab?: "overview" | "activity" | "messages";
};

type DashboardData = {
  items: WorkItem[];
  metrics: Metrics;
  viewCounts: Record<ViewId, number>;
  selected: WorkItem | null;
};

// ---------------------------------------------------------------------------
// Pure helper — exported so tests can call it without I/O
// ---------------------------------------------------------------------------

export function buildDashboardData(
  invoices: InvoiceInput[],
  customers: CustomerInput[],
  lastContacts: LastContactInput[],
  params: DashboardParams,
  today: string,
): DashboardData {
  const { view, sort, q, invoice } = params;

  // 1. Build all work items
  const allItems = buildWorkItems(invoices, customers, lastContacts, today);

  // 2. Apply search filter (case-insensitive substring)
  const searchedItems =
    q.trim() === ""
      ? allItems
      : allItems.filter((i) => i.searchText.includes(q.toLowerCase()));

  // 3. Compute metrics + viewCounts over the search-filtered (not view-filtered) set
  const metrics = computeMetrics(searchedItems);

  const ALL_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted"];
  const viewCounts = Object.fromEntries(
    ALL_VIEWS.map((v) => [v, applyView(searchedItems, v).length]),
  ) as Record<ViewId, number>;

  // 4. Apply view filter + sort for the displayed items list
  const viewFiltered = applyView(searchedItems, view);
  const items = sortItems(viewFiltered, sort);

  // 5. Selected item — look it up from the full searched set (not view-filtered)
  const selected =
    invoice != null
      ? (searchedItems.find((i) => i.invoiceId === invoice) ?? null)
      : null;

  return { items, metrics, viewCounts, selected };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// Supabase row shapes returned by the invoice+customer embed query
type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | string | null;
  due_date: string | null;
  customer_id: string | null;
  customers: { name: string | null; phone: string | null; email: string | null } | null;
};

type TextMessageRow = {
  invoice_id: string;
  created_at: string;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
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
  const initials = emailParts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  // Connection status — service client only (no RLS needed for own org's connection)
  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";

  // Sync label from last_sync_at
  let syncLabel = "Not connected";
  if (connected) {
    const { data: connMeta } = await service
      .from("qbo_connections")
      .select("last_sync_at")
      .eq("org_id", org.org_id)
      .maybeSingle();
    const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;
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
  }

  // Parse URL params
  const url = new URL(request.url);
  const sp = url.searchParams;

  const VALID_VIEWS: ViewId[] = ["all-open", "30-plus", "high-value", "never-contacted"];
  const VALID_SORTS: SortId[] = ["recommended", "most-overdue", "highest-balance", "customer"];
  const VALID_TABS = ["overview", "activity", "messages"] as const;

  const rawView = sp.get("view") ?? "";
  const rawSort = sp.get("sort") ?? "";
  const rawTab = sp.get("tab") ?? "";

  const view: ViewId = VALID_VIEWS.includes(rawView as ViewId) ? (rawView as ViewId) : "all-open";
  const sort: SortId = VALID_SORTS.includes(rawSort as SortId) ? (rawSort as SortId) : "recommended";
  const q = sp.get("q") ?? "";
  const invoice = sp.get("invoice") ?? null;
  const tab: "overview" | "activity" | "messages" = VALID_TABS.includes(
    rawTab as "overview" | "activity" | "messages",
  )
    ? (rawTab as "overview" | "activity" | "messages")
    : "overview";

  const today = new Date().toISOString().slice(0, 10);

  let dashboardData: DashboardData = {
    items: [],
    metrics: {
      thirtyPlus: { count: 0, amount: 0 },
      highValue: { count: 0, amount: 0 },
      neverContacted: { count: 0, amount: 0 },
      allOpen: { count: 0, amount: 0 },
    },
    viewCounts: {
      "all-open": 0,
      "30-plus": 0,
      "high-value": 0,
      "never-contacted": 0,
    },
    selected: null,
  };

  if (connected) {
    // RLS-scoped invoice read (USER client)
    const { data: invRows } = await supabase
      .from("invoices")
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email)")
      .eq("org_id", org.org_id)
      .gt("balance", 0)
      .lt("due_date", today);

    const rawInvoices = (invRows as unknown as InvoiceRow[]) ?? [];

    // Build InvoiceInput arrays
    const invoicesInput: InvoiceInput[] = rawInvoices.map((r) => ({
      id: r.id,
      qbo_doc_number: r.qbo_doc_number,
      customer_id: r.customer_id,
      balance: Number(r.balance ?? 0),
      due_date: r.due_date,
    }));

    // Deduplicate customers from the embedded rows
    const customerMap = new Map<string, CustomerInput>();
    for (const r of rawInvoices) {
      if (r.customer_id && r.customers && !customerMap.has(r.customer_id)) {
        customerMap.set(r.customer_id, {
          id: r.customer_id,
          name: r.customers.name ?? "(unknown customer)",
          phone: r.customers.phone ?? null,
          email: r.customers.email ?? null,
        });
      }
    }
    const customersInput: CustomerInput[] = [...customerMap.values()];

    // Per-invoice latest outbound text_messages (USER client / RLS)
    const lastContactsInput: LastContactInput[] = [];
    if (rawInvoices.length > 0) {
      const invoiceIds = rawInvoices.map((r) => r.id);
      // Fetch all outbound messages ordered by created_at desc; keep first per invoice
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("invoice_id, created_at")
        .in("invoice_id", invoiceIds)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false });

      const seenInvoices = new Set<string>();
      for (const row of (msgRows as unknown as TextMessageRow[]) ?? []) {
        if (!seenInvoices.has(row.invoice_id)) {
          seenInvoices.add(row.invoice_id);
          lastContactsInput.push({
            invoiceId: row.invoice_id,
            date: row.created_at,
            channel: "Text",
          });
        }
      }
    }

    dashboardData = buildDashboardData(
      invoicesInput,
      customersInput,
      lastContactsInput,
      { view, sort, q, invoice, tab },
      today,
    );
  }

  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      userInitials: initials,
      isOwner: org.role === "owner",
      connected,
      syncLabel,
      view,
      sort,
      q,
      invoice,
      tab,
      ...dashboardData,
    },
    { headers },
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const {
    orgName,
    userInitials,
    isOwner,
    connected,
    syncLabel,
    view,
    sort,
    q,
    tab,
    items,
    metrics,
    viewCounts,
    selected,
  } = useLoaderData<typeof loader>();

  return (
    <AppShell
      orgName={orgName}
      userInitials={userInitials}
      syncLabel={syncLabel}
      connected={connected}
      isOwner={isOwner}
    >
      {connected ? (
        <div className="flex flex-col h-full">
          {/* Metrics strip */}
          <div className="px-4 pt-4 pb-3 border-b border-border bg-panel shrink-0">
            <MetricsStrip metrics={metrics} />
          </div>

          {/* Refresh / Disconnect actions (compact row below metrics) */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface shrink-0">
            <Form method="post" action="/api/qbo/refresh">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-sans text-muted hover:text-text hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                Refresh from QuickBooks
              </button>
            </Form>
            {isOwner && (
              <Form method="post" action="/api/qbo/disconnect">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-sans text-muted hover:text-text hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                >
                  Disconnect
                </button>
              </Form>
            )}
          </div>

          {/* Two-pane workspace */}
          <div className="flex flex-1 overflow-hidden">
            {/* Work queue — left pane */}
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <WorkQueue
                items={items}
                view={view}
                sort={sort}
                search={q}
                selectedInvoiceId={selected?.invoiceId ?? null}
                totalCount={viewCounts["all-open"]}
                viewCounts={viewCounts}
              />
            </div>

            {/* Detail panel — right pane, hidden on mobile when nothing selected */}
            <div
              className={[
                "w-80 xl:w-96 shrink-0 overflow-hidden",
                // On mobile: only show if an invoice is selected
                selected ? "block" : "hidden md:block",
              ].join(" ")}
            >
              <DetailPanel selected={selected ?? null} activeTab={tab} />
            </div>
          </div>
        </div>
      ) : (
        /* Not connected */
        <div className="flex flex-col items-center justify-center gap-6 h-full px-6 py-16 text-center">
          <div className="max-w-sm">
            <h2 className="font-display text-2xl font-semibold text-text mb-2">
              Connect QuickBooks
            </h2>
            <p className="font-sans text-sm text-muted mb-6">
              Sync your past-due invoices to start working your collections queue.
            </p>
            {isOwner ? (
              <Form method="post" action="/api/qbo/connect">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-copper px-5 py-2.5 text-sm font-sans font-semibold text-ink hover:bg-copper/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-offset-2"
                >
                  Connect QuickBooks
                </button>
              </Form>
            ) : (
              <p className="font-sans text-sm text-text font-medium">
                Ask an owner to connect QuickBooks.
              </p>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
