import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CUSTOMER_DAY_CAP, EMAIL_ORG_HOUR_CAP,
  SMS_CUSTOMER_DAY_CAP, SMS_ORG_HOUR_CAP, TEST_HOUR_CAP,
  dayAgoIso, evaluateSendBudget, evaluateTestBudget, hourAgoIso,
  type BudgetVerdict,
} from "./send-limits";

async function countOutbound(
  service: SupabaseClient,
  table: "text_messages" | "email_messages",
  args: { orgId: string; customerId?: string; since: string },
): Promise<number> {
  let q = service.from(table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", args.orgId)
    .eq("direction", "outbound")
    .gte("created_at", args.since);
  if (args.customerId) q = q.eq("customer_id", args.customerId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function assertSmsBudget(
  service: SupabaseClient,
  args: { orgId: string; customerId: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const [orgCount, customerCount] = await Promise.all([
    countOutbound(service, "text_messages", { orgId: args.orgId, since: hourAgoIso(now) }),
    countOutbound(service, "text_messages", {
      orgId: args.orgId, customerId: args.customerId, since: dayAgoIso(now),
    }),
  ]);
  const verdict = evaluateSendBudget({
    orgCount, customerCount, orgCap: SMS_ORG_HOUR_CAP, customerCap: SMS_CUSTOMER_DAY_CAP,
  });
  throwIfCapped(verdict);
}

export async function assertEmailBudget(
  service: SupabaseClient,
  args: { orgId: string; customerId: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const [orgCount, customerCount] = await Promise.all([
    countOutbound(service, "email_messages", { orgId: args.orgId, since: hourAgoIso(now) }),
    countOutbound(service, "email_messages", {
      orgId: args.orgId, customerId: args.customerId, since: dayAgoIso(now),
    }),
  ]);
  const verdict = evaluateSendBudget({
    orgCount, customerCount, orgCap: EMAIL_ORG_HOUR_CAP, customerCap: EMAIL_CUSTOMER_DAY_CAP,
  });
  throwIfCapped(verdict);
}

export async function assertTestBudget(
  service: SupabaseClient,
  table: "text_messages" | "email_messages",
  args: { orgId: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const count = await countOutbound(service, table, {
    orgId: args.orgId, since: hourAgoIso(now),
  });
  const verdict = evaluateTestBudget(count, TEST_HOUR_CAP);
  if (!verdict.ok) throw new Error("Test send rate cap reached");
}

function throwIfCapped(verdict: BudgetVerdict): void {
  if (verdict.ok) return;
  throw new Error(
    verdict.reason === "org_cap"
      ? "Send rate cap reached for this workspace"
      : "Send rate cap reached for this customer",
  );
}
