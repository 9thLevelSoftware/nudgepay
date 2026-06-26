import { redirect, useLoaderData, Link, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { listOrgMembers } from "../lib/orgs.server";
import { addCalendarDays } from "../lib/business-days";
import { AppShell } from "../components/AppShell";
import {
  buildTeamReport, REPORT_RANGES, type ReportRange, type TeamReport,
  type ReportContactLog, type ReportPromise, type ReportOpenedCase, type ReportWorkloadCase,
} from "../lib/reports";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  // Owner-only surface gate (not a security boundary — rows are RLS-readable).
  if (org.role !== "owner") throw redirect("/dashboard", { headers });

  const service = createSupabaseServiceClient(env);

  // Org chrome (mirror dashboard)
  const { data: orgRow } = await supabase.from("organizations").select("name").eq("id", org.org_id).single();
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials = emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";

  // Window
  const url = new URL(request.url);
  const rawRange = Number(url.searchParams.get("range"));
  const range: ReportRange = (REPORT_RANGES as readonly number[]).includes(rawRange) ? (rawRange as ReportRange) : 30;
  const today = new Date().toISOString().slice(0, 10);
  const windowStart = addCalendarDays(today, -range);

  // Roster
  const roster = (await listOrgMembers(service, org.org_id)).map((m) => ({ userId: m.userId, label: m.label }));

  // Windowed contact logs (serve BOTH throughput and first-contact)
  const { data: logRows } = await supabase
    .from("contact_logs")
    .select("user_id, case_id, created_at")
    .eq("org_id", org.org_id)
    .gte("created_at", windowStart);
  const contactLogs: ReportContactLog[] = ((logRows as any[]) ?? []).map((r) => ({
    userId: r.user_id, caseId: r.case_id ?? null, createdAt: r.created_at,
  }));

  // Windowed resolved promises
  const { data: promRows } = await supabase
    .from("promises")
    .select("created_by, status, resolved_at")
    .eq("org_id", org.org_id)
    .in("status", ["kept", "partially_kept", "broken"])
    .gte("resolved_at", windowStart);
  const promises: ReportPromise[] = ((promRows as any[]) ?? []).map((r) => ({
    createdBy: r.created_by ?? null, status: r.status, resolvedAt: r.resolved_at ?? null,
  }));

  // Cases opened in window (for first-contact)
  const { data: openedRows } = await supabase
    .from("collection_cases")
    .select("id, opened_at")
    .eq("org_id", org.org_id)
    .gte("opened_at", windowStart);
  const openedCases: ReportOpenedCase[] = ((openedRows as any[]) ?? []).map((r) => ({
    caseId: r.id, openedAt: r.opened_at,
  }));

  // --- Workload snapshot (current open cases; lighter than the dashboard pipeline) ---
  const { data: openCaseRows } = await supabase
    .from("collection_cases")
    .select("id, customer_id, status, exception_reason, next_action_at")
    .eq("org_id", org.org_id)
    .is("closed_at", null);
  const openCases = ((openCaseRows as any[]) ?? []);
  const customerIds = [...new Set(openCases.map((c) => c.customer_id).filter(Boolean))];

  // Owner per customer
  const ownerByCustomer = new Map<string, string | null>();
  if (customerIds.length > 0) {
    const { data: custRows } = await supabase
      .from("customers").select("id, owner").eq("org_id", org.org_id).in("id", customerIds);
    for (const r of (custRows as any[]) ?? []) ownerByCustomer.set(r.id, r.owner ?? null);
  }

  // Overdue total per customer
  const overdueByCustomer = new Map<string, number>();
  const { data: invRows } = await supabase
    .from("invoices").select("customer_id, balance").eq("org_id", org.org_id)
    .gt("balance", 0).lt("due_date", today);
  for (const r of (invRows as any[]) ?? []) {
    if (!r.customer_id) continue;
    overdueByCustomer.set(r.customer_id, (overdueByCustomer.get(r.customer_id) ?? 0) + (Number(r.balance) || 0));
  }

  // Cases with a current broken promise
  const brokenCaseIds = new Set<string>();
  const { data: brokenRows } = await supabase
    .from("promises").select("case_id").eq("org_id", org.org_id).eq("status", "broken");
  for (const r of (brokenRows as any[]) ?? []) if (r.case_id) brokenCaseIds.add(r.case_id);

  const workloadCases: ReportWorkloadCase[] = openCases.map((c) => ({
    caseId: c.id,
    ownerId: c.customer_id ? (ownerByCustomer.get(c.customer_id) ?? null) : null,
    status: c.status,
    exceptionReason: c.exception_reason ?? null,
    nextActionAt: c.next_action_at ?? null,
    overdueTotal: c.customer_id ? (overdueByCustomer.get(c.customer_id) ?? 0) : 0,
    hasBrokenPromise: brokenCaseIds.has(c.id),
  }));

  const report = buildTeamReport({ range, roster, contactLogs, promises, openedCases, workloadCases, today });

  let syncLabel = connected ? "Connected" : "Not connected";

  return Response.json(
    { report, orgName: (orgRow?.name as string) ?? "Workspace", initials, connected, syncLabel },
    { headers },
  );
}

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(x: number | null): string {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}
function fmtHours(x: number | null): string {
  return x == null ? "—" : x < 24 ? `${x.toFixed(1)}h` : `${(x / 24).toFixed(1)}d`;
}

export default function Reports() {
  const { report, orgName, initials, connected, syncLabel } = useLoaderData() as {
    report: TeamReport; orgName: string; initials: string; connected: boolean; syncLabel: string;
  };
  const teamContacts = report.perRep.reduce((s, r) => s + r.contactsLogged, 0);
  const teamKept = report.perRep.reduce((s, r) => s + r.kept, 0);
  const teamResolved = report.perRep.reduce((s, r) => s + r.resolved, 0);
  const teamKeptRate = teamResolved === 0 ? null : teamKept / teamResolved;

  return (
    <AppShell orgName={orgName} userInitials={initials} syncLabel={syncLabel} connected={connected} isOwner={true} syncIssues={null}>
      <div className="px-6 py-5 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-semibold text-text">Team performance</h1>
          {/* Range toggle */}
          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {REPORT_RANGES.map((r) => (
              <Link
                key={r}
                to={`/reports?range=${r}`}
                aria-current={report.range === r ? "true" : undefined}
                className={`rounded-md border px-3 py-1.5 text-sm font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper ${
                  report.range === r ? "border-copper bg-copper/10 text-copper" : "border-border bg-panel text-muted hover:text-text"
                }`}
              >
                {r}d
              </Link>
            ))}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Median time to first contact</p>
            <p className="mt-1 font-display text-2xl text-text">{fmtHours(report.firstContact.medianHours)}</p>
            <p className="text-xs text-muted">{fmtPct(report.firstContact.within24hPct)} within 24h · {report.firstContact.uncontacted} uncontacted</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Contacts logged ({report.range}d)</p>
            <p className="mt-1 font-display text-2xl text-text">{teamContacts}</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Team promise-kept rate</p>
            <p className="mt-1 font-display text-2xl text-text">{fmtPct(teamKeptRate)}</p>
            <p className="text-xs text-muted">{teamKept} kept / {teamResolved} resolved</p>
          </div>
        </div>

        {/* Per-rep table */}
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">By rep</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm font-sans">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Rep</th>
                  <th className="px-3 py-2 text-right font-medium">Contacts</th>
                  <th className="px-3 py-2 text-right font-medium">Cases touched</th>
                  <th className="px-3 py-2 text-right font-medium">Kept</th>
                  <th className="px-3 py-2 text-right font-medium">Partial</th>
                  <th className="px-3 py-2 text-right font-medium">Broken</th>
                  <th className="px-3 py-2 text-right font-medium">Kept rate</th>
                </tr>
              </thead>
              <tbody>
                {report.perRep.map((r) => (
                  <tr key={r.userId} className="border-t border-border text-text">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right">{r.contactsLogged}</td>
                    <td className="px-3 py-2 text-right">{r.casesTouched}</td>
                    <td className="px-3 py-2 text-right">{r.kept}</td>
                    <td className="px-3 py-2 text-right">{r.partiallyKept}</td>
                    <td className="px-3 py-2 text-right">{r.broken}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.keptRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Workload table */}
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">Current workload</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm font-sans">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Owner</th>
                  <th className="px-3 py-2 text-right font-medium">Open cases</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Broken promises</th>
                </tr>
              </thead>
              <tbody>
                {report.workload.map((w) => (
                  <tr key={w.ownerId ?? "unassigned"} className="border-t border-border text-text">
                    <td className="px-3 py-2">{w.label}</td>
                    <td className="px-3 py-2 text-right">{w.openCases}</td>
                    <td className="px-3 py-2 text-right">{fmtUSD(w.overdueTotal)}</td>
                    <td className="px-3 py-2 text-right">{w.brokenPromises}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
