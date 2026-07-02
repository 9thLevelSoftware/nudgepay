// Server-side alert email sender. Deps-injected for testability.
// Uses the generic sendEmail transport from email-client.server.ts,
// bypassing customer-specific coupling in email-messaging.server.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { listOrgMembers } from "./orgs.server";
import { brokenPromiseEmail, digestEmail, type DigestCaseLine } from "./notifications";
import type { BrokenPromiseDetail } from "./promise-evaluation.server";
import { isCaseSuppressed } from "./exceptions";
import type { ExceptionReason } from "./contact-log";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export type NotificationDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig;
  appUrl: string;
};

// ---------------------------------------------------------------------------
// Broken-promise immediate emails
// ---------------------------------------------------------------------------

export async function sendBrokenPromiseAlerts(
  deps: NotificationDeps,
  orgId: string,
  brokenDetails: BrokenPromiseDetail[],
  today: string,
): Promise<void> {
  // Gate: org must have email enabled with a from_address
  const { data: ecfg } = await deps.service
    .from("email_config")
    .select("email_enabled, from_address, from_name")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!ecfg?.email_enabled || !ecfg.from_address) return;
  const from = ecfg.from_name ? `${ecfg.from_name} <${ecfg.from_address}>` : ecfg.from_address;

  // Resolve members + their prefs
  const members = await listOrgMembers(deps.service, orgId);
  const { data: prefsRows } = await deps.service
    .from("user_notification_prefs")
    .select("user_id, broken_promise_email")
    .eq("org_id", orgId);
  const prefsMap = new Map((prefsRows ?? []).map((r: any) => [r.user_id as string, r]));

  for (const detail of brokenDetails) {
    // Resolve customer name from the case
    const { data: caseRow } = await deps.service
      .from("collection_cases")
      .select("customer_id")
      .eq("id", detail.caseId)
      .maybeSingle();
    const customerId = caseRow?.customer_id as string | null;
    let customerName = "(unknown customer)";
    let ownerId: string | null = null;
    if (customerId) {
      const { data: cust } = await deps.service
        .from("customers")
        .select("name, owner")
        .eq("id", customerId)
        .maybeSingle();
      if (cust?.name) customerName = cust.name as string;
      ownerId = (cust?.owner as string) ?? null;
    }

    // Recipients: account owner if set, otherwise all org members
    const recipients = ownerId
      ? members.filter((m) => m.userId === ownerId)
      : members;
    if (recipients.length === 0) continue;

    const emailContent = brokenPromiseEmail({
      customerName,
      promisedAmount: detail.promisedAmount,
      promisedDate: detail.promisedDate,
      appUrl: deps.appUrl,
    });

    for (const member of recipients) {
      // Check opt-out
      const pref = prefsMap.get(member.userId);
      if (pref && pref.broken_promise_email === false) continue;
      if (!member.email) continue;

      // Ledger-first: insert dedup row; 23505 (unique violation) → already sent
      const dedupeKey = `promise:${detail.promiseId}:${member.userId}`;
      const { error: ledgerErr } = await deps.service
        .from("notification_log")
        .insert({ org_id: orgId, kind: "broken_promise", dedupe_key: dedupeKey, recipient_email: member.email });
      if (ledgerErr) {
        if (ledgerErr.code === "23505") continue; // already sent
        console.error("notification ledger insert failed", ledgerErr);
        continue;
      }

      try {
        await sendEmail(deps.fetchFn, deps.email, {
          from,
          to: member.email,
          subject: emailContent.subject,
          html: emailContent.html,
        });
      } catch (e) {
        console.error(`broken-promise email failed for ${member.email}`, e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Daily follow-ups-due digest
// ---------------------------------------------------------------------------

export async function runDailyDigest(
  deps: NotificationDeps,
  orgId: string,
  today: string,
): Promise<void> {
  // Gate: org must have email enabled
  const { data: ecfg } = await deps.service
    .from("email_config")
    .select("email_enabled, from_address, from_name")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!ecfg?.email_enabled || !ecfg.from_address) return;
  const from = ecfg.from_name ? `${ecfg.from_name} <${ecfg.from_address}>` : ecfg.from_address;

  // Open cases with follow-ups due today (next_action_at <= today)
  const { data: caseRows } = await deps.service
    .from("collection_cases")
    .select("id, customer_id, status, next_action_type, next_action_at, exception_reason")
    .eq("org_id", orgId)
    .neq("status", "resolved")
    .lte("next_action_at", today);
  if (!caseRows || caseRows.length === 0) return;

  // Filter out suppressed cases
  const activeCases = caseRows.filter((c: any) => !isCaseSuppressed({
    status: c.status as string,
    exceptionReason: c.exception_reason as ExceptionReason | null,
    nextActionAt: c.next_action_at as string | null,
    today,
  }));
  if (activeCases.length === 0) return;

  // Resolve customer details
  const custIds = [...new Set(activeCases.map((c: any) => c.customer_id as string))];
  const { data: custRows } = await deps.service
    .from("customers")
    .select("id, name, owner")
    .eq("org_id", orgId)
    .in("id", custIds);
  const custById = new Map((custRows ?? []).map((c: any) => [c.id as string, c]));

  // Build per-owner line items
  type CaseEntry = { ownerId: string | null; line: DigestCaseLine };
  const entries: CaseEntry[] = activeCases.map((c: any) => {
    const cust = custById.get(c.customer_id as string);
    return {
      ownerId: (cust?.owner as string) ?? null,
      line: {
        customerName: (cust?.name as string) ?? "(unknown customer)",
        totalOverdue: 0, // balance is available from invoices, but we keep it simple
        nextActionAt: c.next_action_at as string | null,
      },
    };
  });

  // Enrich with total overdue per customer (sum of overdue invoices)
  const { data: invRows } = await deps.service
    .from("invoices")
    .select("customer_id, balance, due_date")
    .eq("org_id", orgId)
    .gt("balance", 0)
    .lt("due_date", today)
    .in("customer_id", custIds);
  const balanceByCust = new Map<string, number>();
  for (const inv of invRows ?? []) {
    const cid = inv.customer_id as string;
    balanceByCust.set(cid, (balanceByCust.get(cid) ?? 0) + Number(inv.balance ?? 0));
  }
  for (const entry of entries) {
    const cust = custById.get(activeCases.find((c: any) =>
      (custById.get(c.customer_id as string)?.name ?? "(unknown customer)") === entry.line.customerName
    )?.customer_id as string ?? "");
    if (cust) {
      entry.line.totalOverdue = balanceByCust.get(cust.id as string) ?? 0;
    }
  }

  // Members + prefs
  const members = await listOrgMembers(deps.service, orgId);
  const { data: prefsRows } = await deps.service
    .from("user_notification_prefs")
    .select("user_id, daily_digest_email")
    .eq("org_id", orgId);
  const prefsMap = new Map((prefsRows ?? []).map((r: any) => [r.user_id as string, r]));

  // Determine who is an org owner (for unassigned case routing)
  const { data: membershipRows } = await deps.service
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId);
  const ownerUserIds = new Set(
    (membershipRows ?? []).filter((m: any) => m.role === "owner").map((m: any) => m.user_id as string)
  );

  // Group entries by owner
  const unassigned = entries.filter((e) => !e.ownerId).map((e) => e.line);
  const byOwner = new Map<string, DigestCaseLine[]>();
  for (const entry of entries) {
    if (!entry.ownerId) continue;
    const list = byOwner.get(entry.ownerId) ?? [];
    list.push(entry.line);
    byOwner.set(entry.ownerId, list);
  }

  // Send per-member digest
  for (const member of members) {
    const pref = prefsMap.get(member.userId);
    if (pref && pref.daily_digest_email === false) continue;
    if (!member.email) continue;

    const assignedCases = byOwner.get(member.userId) ?? [];
    // Unassigned cases go to owners only
    const unassignedForMember = ownerUserIds.has(member.userId) ? unassigned : [];
    if (assignedCases.length === 0 && unassignedForMember.length === 0) continue;

    // Ledger-first dedup
    const dedupeKey = `digest:${member.userId}:${today}`;
    const { error: ledgerErr } = await deps.service
      .from("notification_log")
      .insert({ org_id: orgId, kind: "daily_digest", dedupe_key: dedupeKey, recipient_email: member.email });
    if (ledgerErr) {
      if (ledgerErr.code === "23505") continue; // already sent today
      console.error("digest ledger insert failed", ledgerErr);
      continue;
    }

    const emailContent = digestEmail({
      recipientName: member.label,
      assignedCases,
      unassignedCases: unassignedForMember,
      appUrl: deps.appUrl,
      today,
    });

    try {
      await sendEmail(deps.fetchFn, deps.email, {
        from,
        to: member.email,
        subject: emailContent.subject,
        html: emailContent.html,
      });
    } catch (e) {
      console.error(`digest email failed for ${member.email}`, e);
    }
  }
}
