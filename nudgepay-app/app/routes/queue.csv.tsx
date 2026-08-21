import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadCaseQueueSource } from "../lib/case-queue.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { todayInTz } from "../lib/tz";
import { buildCaseItems, applyCaseView, sortCaseItems } from "../lib/cases";
import { queueItemsToCsv } from "../lib/queue-csv";
import type { ViewId, SortId } from "../lib/worklist";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user, org } = await requireOrgUser(request, env);
  const service = createSupabaseServiceClient(env);
  const orgConfig = await loadOrgConfig(supabase, org.org_id);
  const today = todayInTz(orgConfig.companyProfile.timezone);
  const src = await loadCaseQueueSource({
    supabase, service, orgId: org.org_id, today, includePresence: false, orgConfig,
  });
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") ?? "all-open") as ViewId;
  const sort = (url.searchParams.get("sort") ?? "recommended") as SortId;
  const items = sortCaseItems(
    applyCaseView(
      buildCaseItems(
        src.cases, src.invoicesInput, src.customersInput, src.lastContactsInput,
        src.promisesInput, today, src.ownerLabels, src.orgConfig,
      ),
      view, today, user.id, src.orgConfig.priority.highValue,
    ),
    sort,
  );
  const csv = queueItemsToCsv(items.map((i) => ({
    customerName: i.customerName,
    status: i.status,
    totalOverdue: i.totalOverdue,
    oldestAgeDays: i.oldestAgeDays,
    invoiceCount: i.invoiceCount,
    lastContactDate: i.lastContact?.date ?? null,
    lastContactChannel: i.lastContact?.channel ?? null,
    owner: i.owner,
  })));
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", 'attachment; filename="nudgepay-queue.csv"');
  return new Response(csv, { status: 200, headers });
}
