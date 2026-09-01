import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { parseReportRange, parseReportSheet, teamReportToCsv, arKpisToCsv } from "../lib/reports";
import { loadTeamReport, loadReportArKpis } from "../lib/reports.server";

// Resource route: admin+ CSV of the current range (team per-rep or AR KPIs).
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, service, headers, org } = await loadWorkspaceChrome(
    request, env, { requireQbo: false, requireAdmin: true },
  );

  const url = new URL(request.url);
  const range = parseReportRange(url.searchParams.get("range"));
  const sheet = parseReportSheet(url.searchParams.get("sheet"));

  let csv: string;
  let filename: string;
  if (sheet === "ar") {
    const arKpis = await loadReportArKpis({ supabase, orgId: org.org_id, range });
    if (arKpis.loadError) {
      return new Response(arKpis.loadError, { status: 503, headers });
    }
    if (arKpis.truncated) {
      return new Response(
        "This list is incomplete (over 5,000 rows). Totals may under-count.",
        { status: 409, headers },
      );
    }
    csv = arKpisToCsv(arKpis);
    filename = `nudgepay-ar-${range}d.csv`;
  } else {
    const report = await loadTeamReport({ supabase, service, orgId: org.org_id, range });
    if (report.loadError) {
      return new Response(report.loadError, { status: 503, headers });
    }
    if (report.truncated) {
      return new Response(
        "This list is incomplete (over 5,000 rows). Totals may under-count.",
        { status: 409, headers },
      );
    }
    csv = teamReportToCsv(report);
    filename = `nudgepay-report-${range}d.csv`;
  }

  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(csv, { status: 200, headers });
}
