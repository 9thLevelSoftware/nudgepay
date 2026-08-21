import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { parseReportRange, teamReportToCsv } from "../lib/reports";
import { loadTeamReport } from "../lib/reports.server";

// Resource route: owner-only CSV of the current range's per-rep table.
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, service, headers, org } = await loadWorkspaceChrome(
    request, env, { requireQbo: false, requireOwner: true },
  );

  const range = parseReportRange(new URL(request.url).searchParams.get("range"));
  const report = await loadTeamReport({ supabase, service, orgId: org.org_id, range });
  const csv = teamReportToCsv(report);

  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="nudgepay-report-${range}d.csv"`);
  return new Response(csv, { status: 200, headers });
}
