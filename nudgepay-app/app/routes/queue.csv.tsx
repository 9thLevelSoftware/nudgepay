import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadCaseQueueSource } from "../lib/case-queue.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { todayInTz } from "../lib/tz";
import { buildCaseItems, applyCaseView, sortCaseItems } from "../lib/cases";
import { applyInvoiceView, buildInvoiceQueue, sortInvoiceItems } from "../lib/invoice-queue";
import { queueItemsToCsv } from "../lib/queue-csv";
import type { ViewId } from "../lib/worklist";
import { parseEntityMode, parseSort } from "../lib/queue-chrome";
import { loadReplySource, peekWindowStartIso } from "../lib/activity-peek.server";
import { loadPayerSource } from "../lib/payer-behavior.server";

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
  const sort = parseSort(url.searchParams.get("sort"));
  const entity = parseEntityMode(url.searchParams.get("entity"));
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const highValue = src.orgConfig.priority.highValue;
  const customerIds = [...new Set([
    ...src.cases.map((c) => c.customerId),
    ...src.invoicesInput.map((i) => i.customer_id ?? ""),
    ...src.comingDueInvoices.map((i) => i.customer_id ?? ""),
  ].filter(Boolean))];
  const brokenPromiseByCustomer = new Map<string, boolean>();
  const caseById = new Map(src.cases.map((c) => [c.id, c]));
  for (const p of src.promisesInput) {
    if (p.status !== "broken") continue;
    const cse = caseById.get(p.caseId);
    if (cse) brokenPromiseByCustomer.set(cse.customerId, true);
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
  const allItems = buildCaseItems(
    src.cases, src.invoicesInput, src.customersInput, src.lastContactsInput,
    src.promisesInput, today, src.ownerLabels, src.orgConfig,
  ).map((i) => ({ ...i, payer: payerByCustomer.get(i.customerId) ?? null }));
  const searched = q === "" ? allItems : allItems.filter((i) => i.searchText.includes(q));
  const items = sortCaseItems(applyCaseView(searched, view, today, user.id, highValue), sort);
  const invoiceMode = entity === "invoices" && view !== "coming-due";
  let csv: string;
  if (invoiceMode) {
    const casesByCustomer = new Map(
      allItems.map((i) => [i.customerId, {
        caseId: i.caseId, lastContact: i.lastContact, peeks: i.peeks, suppressed: i.suppressed,
      }]),
    );
    const built = buildInvoiceQueue({
      invoices: [...src.invoicesInput, ...src.comingDueInvoices],
      casesByCustomer,
      customers: src.customersInput,
      ownerLabels: src.ownerLabels,
      payerByCustomer,
      today,
    });
    const searchedInv = q === "" ? built : built.filter((i) => i.searchText.includes(q));
    const matchingCaseIds = new Set(items.map((i) => i.caseId));
    csv = queueItemsToCsv(sortInvoiceItems(
      applyInvoiceView(searchedInv, view, { matchingCaseIds, currentUserId: user.id, highValue }),
      sort,
    ).map((i) => ({
      customerName: i.customerName,
      status: "",
      totalOverdue: i.balance,
      oldestAgeDays: i.ageDays,
      invoiceCount: 1,
      lastContactDate: i.lastContact?.date ?? null,
      lastContactChannel: i.lastContact?.channel ?? null,
      owner: i.owner,
      entity: "invoices",
      docNumber: i.docNumber,
      payerBand: i.payer?.band ?? null,
      daysToPay: i.payer?.daysToPay ?? null,
      replyRate: i.payer?.replyRate ?? null,
    })));
  } else {
    csv = queueItemsToCsv(items.map((i) => ({
      customerName: i.customerName,
      status: i.status,
      totalOverdue: i.totalOverdue,
      oldestAgeDays: i.oldestAgeDays,
      invoiceCount: i.invoiceCount,
      lastContactDate: i.lastContact?.date ?? null,
      lastContactChannel: i.lastContact?.channel ?? null,
      owner: i.owner,
      entity: "customers",
      docNumber: null,
      payerBand: i.payer?.band ?? null,
      daysToPay: i.payer?.daysToPay ?? null,
      replyRate: i.payer?.replyRate ?? null,
    })));
  }
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", 'attachment; filename="nudgepay-queue.csv"');
  return new Response(csv, { status: 200, headers });
}
