import { data, useLoaderData, Link, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { AppShell } from "../components/AppShell";
import { SyncIssues } from "../components/SyncIssues";
import { REPORT_RANGES, parseReportRange } from "../lib/reports";
import { loadTeamReport, loadReportArKpis } from "../lib/reports.server";
import { ArKpiBand } from "../components/ArKpiBand";
import { AgingBarChart, ChartCard, TrendLineChart } from "../components/SvgCharts";
import { ContentShell } from "../components/ContentShell";
import { pageTitle } from "../lib/meta";
import { TruncationBanner } from "../components/TruncationBanner";
import type { Route } from "./+types/reports";

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data) return pageTitle("Reports");
  return pageTitle(`Reports · ${data.report.range}d`);
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, service, headers, org,
    orgName, initials, userLabel, connected, syncLabel, syncIssues,
  } = await loadWorkspaceChrome(request, env, { requireQbo: false, requireOwner: true });
  // Owner-only surface gate is enforced inside the helper
  // (redirects to /dashboard?denied=reports for non-owners).

  const range = parseReportRange(new URL(request.url).searchParams.get("range"));
  const [report, arKpis] = await Promise.all([
    loadTeamReport({ supabase, service, orgId: org.org_id, range }),
    loadReportArKpis({ supabase, orgId: org.org_id, range }),
  ]);

  return data(
    { report, arKpis, orgName, initials, userLabel, connected, syncLabel, syncIssues },
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
  const { report, arKpis, orgName, initials, userLabel, connected, syncLabel, syncIssues } = useLoaderData<typeof loader>();
  const truncated = report.truncated || arKpis.coverage === "partial";
  const teamContacts = report.perRep.reduce((s, r) => s + r.contactsLogged, 0);
  const teamKept = report.perRep.reduce((s, r) => s + r.kept, 0);
  const teamResolved = report.perRep.reduce((s, r) => s + r.resolved, 0);
  const teamKeptRate = teamResolved === 0 ? null : teamKept / teamResolved;
  const trendPoints = report.trends?.points ?? [];
  const contactTrend = trendPoints.map((point) => ({
    label: point.date.slice(5),
    value: point.contacts,
  }));
  const promiseTrend = trendPoints.map((point) => ({
    label: point.date.slice(5),
    value: point.resolved === 0 ? null : (point.kept / point.resolved) * 100,
  }));

  return (
    <AppShell orgName={orgName} userInitials={initials} userLabel={userLabel} syncLabel={syncLabel} connected={connected} isOwner={true} activeNav="reports" syncIssues={<SyncIssues issues={syncIssues} returnTo="/reports" />}>
      <ContentShell type="workspace" className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl font-semibold text-text">Team performance</h1>
          <div className="flex items-center gap-2">
            <a
              href={`/reports.csv?range=${report.range}`}
              download={`nudgepay-report-${report.range}d.csv`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Download CSV
            </a>
            <a
              href={`/reports.csv?range=${report.range}&sheet=ar`}
              download={`nudgepay-ar-${report.range}d.csv`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Download receivables CSV
            </a>
            <div className="flex items-center gap-1" role="group" aria-label="Time range">
              {REPORT_RANGES.map((r) => (
                <Link
                  key={r}
                  to={`/reports?range=${r}`}
                  aria-current={report.range === r ? "page" : undefined}
                  className={`rounded-md border px-3 py-1.5 text-sm font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper ${
                    report.range === r ? "border-copper bg-copper/10 text-copper" : "border-border bg-panel text-muted hover:text-text"
                  }`}
                >
                  {r}d
                </Link>
              ))}
            </div>
          </div>
        </div>

        {truncated ? <TruncationBanner /> : null}

        <section>
          <ArKpiBand kpis={arKpis} isOwner={false} />
        </section>

        {/* Summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Median time to first contact</p>
            <p className="mt-1 font-display text-2xl text-text">{report.truncated ? "—" : fmtHours(report.firstContact.medianHours)}</p>
            <p className="text-xs text-muted">{report.truncated ? "—" : `${fmtPct(report.firstContact.within24hPct)} within 24h · ${report.firstContact.uncontacted} uncontacted`}</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Contacts logged ({report.range}d)</p>
            <p className="mt-1 font-display text-2xl text-text">{report.truncated ? "—" : teamContacts}</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Team promise-kept rate</p>
            <p className="mt-1 font-display text-2xl text-text">{report.truncated ? "—" : fmtPct(teamKeptRate)}</p>
            <p className="text-xs text-muted">{report.truncated ? "—" : `${teamKept} kept / ${teamResolved} resolved`}</p>
          </div>
        </div>

        {/* Visual summary: money exposure first, then team activity/outcomes. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="A/R aging"
            description={`Open receivables by due-date age · ${fmtUSD(arKpis.inputs.endingTotalAr)} total`}
          >
            <AgingBarChart buckets={arKpis.agingBuckets ?? []} />
          </ChartCard>
          <ChartCard
            title="Contact volume"
            description={`Contacts logged per day over the last ${report.range} days`}
          >
            {contactTrend.length > 0 ? (
              <TrendLineChart
                points={contactTrend}
                label="Daily contact volume"
                tone="cool"
                formatValue={(value) => `${value} contact${value === 1 ? "" : "s"}`}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted">No contact activity in this range.</p>
            )}
          </ChartCard>
        </div>
        <ChartCard
          title="Promise kept-rate trend"
          description="Daily kept rate for promises resolved in the selected period."
        >
          {promiseTrend.some((point) => point.value != null) ? (
            <TrendLineChart
              points={promiseTrend}
              label="Daily promise kept-rate trend"
              tone="copper"
              formatValue={(value) => `${Math.round(value)}% kept`}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted">No resolved promises in this range.</p>
          )}
        </ChartCard>

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
      </ContentShell>
    </AppShell>
  );
}
