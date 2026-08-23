import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("DetailPanel consent posts customerId (NP-AUD-2026-109)", () => {
  const src = read("../app/components/DetailPanel.tsx");
  const form = src.match(/<form method="post" action="\/api\/sms-consent">[\s\S]*?<\/form>/);
  expect(form, "sms-consent form missing").toBeTruthy();
  expect(form![0]).toMatch(/name="customerId"/);
  expect(form![0]).toMatch(/selected\.customerId/);
  expect(form![0]).not.toMatch(/name="assign"/);
});

test("STOP-locked consent hides Mark consented for members; owner override requires reason", () => {
  const src = read("../app/components/DetailPanel.tsx");
  const memberPath = src.match(
    /!consent && smsConsentSource === "inbound_stop" && !isOwner \? \([\s\S]*?\) : \(/,
  );
  expect(memberPath, "member STOP-locked branch missing").toBeTruthy();
  expect(memberPath![0]).toContain("Stopped by inbound STOP. Owner override required.");
  expect(memberPath![0]).not.toMatch(/Mark consented/);
  expect(memberPath![0]).not.toMatch(/type="submit"/);

  const form = src.match(/<form method="post" action="\/api\/sms-consent">[\s\S]*?<\/form>/);
  expect(form, "sms-consent form missing").toBeTruthy();
  expect(form![0]).toMatch(/name="reason"/);
  expect(form![0]).toMatch(/minLength=\{3\}/);
  expect(form![0]).toContain("Override STOP");
  expect(form![0]).toContain("<Input");
});

test("owner STOP override clears do_not_text with consent", () => {
  const src = read("../app/routes/api.sms-consent.tsx");
  expect(src).toContain("overrideStop");
  expect(src).toContain("do_not_text: false");
  expect(src).toContain("stopLocked");
  expect(src).toContain("rewrite inbound_stop");
  expect(src).toContain('select("sms_consent, sms_consent_source, sms_consent_at")');
  expect(src).toContain('.eq("sms_consent_source", "inbound_stop")');
  expect(src).toContain('.eq("sms_consent_at", observedAt)');
});

test("inbox STOP override uses shared Input and wraps on narrow panes", () => {
  const inbox = read("../app/components/MessageThreadPanel.tsx");
  expect(inbox).toContain('from "./ui"');
  expect(inbox).toContain("<Input");
  expect(inbox).toContain("flex-wrap");
  const dash = read("../app/components/DetailPanel.tsx");
  expect(dash).toContain("flex-wrap");
});

test("inbound STOP lock is enforced by a BEFORE INSERT OR UPDATE trigger", () => {
  const sql = read("../supabase/migrations/0047_inbound_stop_lock.sql");
  expect(sql).toContain("prevent_inbound_stop_unlock");
  expect(sql).toMatch(/inbound STOP can only be set by the inbound webhook/);
  expect(sql).toMatch(/TG_OP = 'INSERT'/);
  expect(sql).toMatch(/before insert or update on customers/);
  expect(sql).toMatch(/sms_consent_source is distinct from 'inbound_stop'/);
  expect(sql).toMatch(/sms_consent_at is distinct from old.sms_consent_at/);
  expect(sql).toMatch(/is_org_owner/);
  expect(sql).toMatch(/sms_consent_source := 'staff'/);
  expect(sql).toMatch(/sms_consent_actor := auth\.uid\(\)/);
  expect(sql).toMatch(/sms_consent_at := now\(\)/);
  expect(sql).toMatch(/new\.sms_consent_at is not distinct from old\.sms_consent_at/);
  expect(sql).toContain("btrim(new.sms_consent_reason, E' \\t\\n\\r\\v\\f')");
});

test("invite flash is generic, not raw DB (NP-AUD-2026-126)", () => {
  const action = read("../app/routes/api.members.tsx");
  expect(action).toContain('flag(returnTo, "error", "invite")');
  expect(action).not.toMatch(/error\.message/);
  const ui = read("../app/routes/settings.tsx");
  expect(ui).toMatch(/Could not create that invite/);
});

test("pending invites unique per org+email (NP-AUD-2026-130)", () => {
  const sql = read("../supabase/migrations/0036_memberships_offboarding.sql");
  expect(sql).toContain("invites_pending_email_idx");
  expect(sql).toMatch(/accepted_at is null/i);
});

test("audit-ledger FKs restrict parent deletes so CASCADE cannot bypass child RLS", () => {
  const sql = read("../supabase/migrations/0046_audit_ledger_rls.sql");
  expect(sql).toMatch(/collection_cases_customer_id_fkey[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/promises_customer_id_fkey[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/promise_invoices_invoice_id_fkey[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/email_messages_invoice_id_fkey[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/collection_cases_org_customer_fk[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/promises_org_customer_fk[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/promise_invoices_org_invoice_fk[\s\S]*on delete restrict/i);
  expect(sql).toMatch(/email_messages_org_invoice_fk[\s\S]*on delete restrict/i);
});

test("acceptInvite claims the invite via a single accept_invite RPC", () => {
  const src = read("../app/lib/orgs.server.ts");
  const accept = src.slice(
    src.indexOf("export async function acceptInvite"),
    src.indexOf("export async function createOrgForUser"),
  );
  expect(accept).toContain('.rpc("accept_invite"');
  const sql = read("../supabase/migrations/0045_accept_invite.sql");
  expect(sql).toMatch(/for update/i);
  expect(sql).toMatch(/insert into public\.memberships/i);
});

test("revoke controls use the shared Button primitive", () => {
  const src = read("../app/routes/settings.tsx");
  const revoke = src.slice(
    src.indexOf("function RevokeInviteButton"),
    src.indexOf("function InviteLinkStatus"),
  );
  expect(revoke).toContain("<Button");
  expect(revoke).toContain('variant="destructive"');
  expect(src).toContain("useToast");
  expect(src).toContain("Invite revoked.");
  expect(src).toContain("RevokeInviteToast");
  expect(src).toContain("revokeFetcher");
  expect(revoke).not.toMatch(/<button\b/);
});

test("dashboard scoring uses cases.ts not worklist.priorityOf (NP-AUD-2026-124)", () => {
  const dash = read("../app/routes/dashboard.tsx");
  expect(dash).toContain("buildCaseItems");
  expect(dash).not.toContain("priorityOf");
  const cases = read("../app/lib/cases.ts");
  expect(cases).toContain("scorePriority");
});

test("priority form min matches parser (NP-AUD-2026-045-VALIDATION-RANGE)", () => {
  const form = read("../app/components/PriorityThresholdsForm.tsx");
  const parser = read("../app/lib/org-settings.ts");
  expect(parser).toContain("HIGH_VALUE_THRESHOLD_MIN = 1_000");
  expect(form).toContain("HIGH_VALUE_THRESHOLD_MIN");
  expect(form).not.toMatch(/min=\{0\.01\}/);
});

test("QBO webhook returns 200 via waitUntil (NP-AUD-2026-031)", () => {
  const src = read("../app/routes/webhooks.qbo.tsx");
  expect(src).toContain("waitUntil");
  expect(src).toContain('return new Response("ok", { status: 200 })');
});

test("storeConnection refuses a realm switch (NP-AUD-2026-027)", () => {
  const src = read("../app/lib/qbo-connection.server.ts");
  expect(src).toContain("realm mismatch");
});

test("queue.csv is registered (NP-AUD-2026-048-CSV)", () => {
  const routes = read("../app/routes.ts");
  expect(routes).toContain('"routes/queue.csv.tsx"');
  const queue = read("../app/components/WorkQueue.tsx");
  expect(queue).toContain("/queue.csv");
});

test("LICENSE exists (NP-AUD-2026-133)", () => {
  const license = readFileSync(fileURLToPath(new URL("../../LICENSE", import.meta.url)), "utf8");
  expect(license).toMatch(/9th Level Software/);
});

test("npm metadata is not the RR starter (NP-AUD-2026-132-STARTER)", () => {
  const pkg = JSON.parse(read("../package.json"));
  expect(pkg.description).not.toMatch(/Build a full-stack web application/i);
  expect(pkg.cloudflare.publish).toBe(false);
  expect(pkg.cloudflare.label).toBe("NudgePay");
});

test("AGENTS.md lists migrations through 0041 (NP-AUD-2026-132-AGENTS)", () => {
  const agents = readFileSync(fileURLToPath(new URL("../../AGENTS.md", import.meta.url)), "utf8");
  expect(agents).toMatch(/0001\.\.0041|0001–0041/);
});

test("app README is NudgePay not the starter (NP-AUD-2026-132-README)", () => {
  const readme = read("../README.md");
  expect(readme).toMatch(/NudgePay/);
  expect(readme).not.toMatch(/Welcome to Remix/i);
});

test("sms_sender_inventory uniqueness is on trimmed messaging_service_sid", () => {
  const sql = read("../supabase/migrations/0048_sms_sender_inventory.sql");
  expect(sql).toContain("sms_sender_inventory_messaging_service_sid_key");
  expect(sql).toContain("messaging_service_sid_norm");
  expect(sql).toMatch(/nullif\(lower\(btrim\(messaging_service_sid\)\), ''\)/);
  expect(sql).toMatch(/btrim\(messaging_service_sid\) <> ''/);
  expect(sql).toMatch(/btrim\(from_number\) <> ''/);
});

test("inbound history filters by any webhook SID and keeps pre-migration null-SID fallback", () => {
  const src = read("../app/lib/twilio-messaging.server.ts");
  expect(src).toContain("messagingServiceSid: sid || undefined");
  expect(src).toContain("allowLegacyNullSid: overlapsFallbackSid");
  expect(src).toContain("allowFromHistory: overlapsFallbackFrom");
  expect(src).toContain("!overlapsFallbackSid && !overlapsFallbackFrom");
  expect(src).toContain('.is("messaging_service_sid_norm", null)');
  expect(src).toContain('.is("from_number_norm", null)');
  expect(src).toContain("uniqueSidHistoryOrg");
  expect(src).toContain("uniqueFromHistoryOrg");
  expect(src).toContain("uniqueFromHistoryOrg(service, fromNorm, toNorm)");
  expect(src).toContain("uniqueLegacyNullSidOrg");
  expect(src).toContain('.neq("org_id", orgId)');
  expect(src).toContain(".limit(1)");
  expect(src).toContain('.eq("from_number_norm", toNorm)');
  expect(src).toContain('status: "ambiguous"');
  expect(src).toContain('if (histOrg.status === "ambiguous") return null');
  expect(src).toContain("sidOrg.orgId === fromHist.orgId");
  expect(src).toContain("if (opts.requireFromMatch) return null");
});

test("SMS settings labels unprovisioned when inventory is required", () => {
  const ui = read("../app/components/SmsSettingsSection.tsx");
  expect(ui).toContain("requireInventory");
  expect(ui).toContain("Unprovisioned");
  expect(ui).toContain("Outbound texts are blocked until NudgePay assigns one");
  const settings = read("../app/routes/settings.tsx");
  expect(settings).toContain("smsRequireInventory");
  expect(settings).toContain("requireInventory={d.messaging.requireInventory}");
});

test("JWT cannot stamp text_messages sender identity used for inbound routing", () => {
  const sql = read("../supabase/migrations/0048_sms_sender_inventory.sql");
  expect(sql).toContain("protect_text_message_sender_identity");
  expect(sql).toContain("outbound SMS is service-written");
  expect(sql).toContain("SMS sender identity is service-written");
  expect(sql).toMatch(/auth\.role\(\) = 'service_role'/);
  expect(sql).toMatch(/new\.messaging_service_sid := null/);
  expect(sql).toMatch(/new\.twilio_message_sid := null/);
  expect(sql).toMatch(/new\.org_id is distinct from old\.org_id/);
  expect(sql).toMatch(/TG_OP = 'DELETE'/);
  expect(sql).toMatch(/before insert or update or delete on text_messages/);
});

test("RESEND_ALLOWED_FROM is documented in production deploy config", () => {
  const wrangler = read("../wrangler.toml");
  expect(wrangler).toMatch(/RESEND_ALLOWED_FROM/);
  const render = read("../render.yaml");
  expect(render).toMatch(/RESEND_ALLOWED_FROM/);
});

test("email_config upsert stamps updated_at (NP-AUD-2026-128)", () => {
  const src = read("../app/routes/api.org-settings.tsx");
  expect(src).toContain("emailConfigUpsertRow");
});

test("case-queue pages Stage-1 invoices and cases with truncated chrome (NP-AUD-2026-007-TRUNCATION)", () => {
  const src = read("../app/lib/case-queue.server.ts");
  expect(src).toContain("pageAll");
  expect(src).toContain("pageAllChunked");
  expect(src).toContain('count: "exact"');
  expect(src).toContain("queueTruncated");
  expect(src).toContain("lastContactTruncated");
  expect(src).toContain('.lt("due_date", today)');
  expect(src).toContain('.gte("due_date", today)');
  expect(src).toContain("pageAll<CaseRowRaw>");
  expect(src).not.toContain("assertNotTruncated");
  expect(src).not.toMatch(/throw new Error\("invoices truncated/);
  expect(src).not.toMatch(/throw new Error\("cases truncated/);
});

function dataDestructuresWithoutError(src: string): string[] {
  const out: string[] = [];
  const re = /\{\s*data\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < src.length; i++) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const obj = src.slice(m.index, end + 1);
    if (!/\berror\b/.test(obj)) out.push(obj.replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

test("listed loaders check error on every { data: destructure including Promise.all arms", () => {
  const files = [
    "../app/routes/messages.tsx",
    "../app/routes/promises.tsx",
    "../app/routes/accounts.tsx",
    "../app/lib/reports.server.ts",
    "../app/lib/case-queue.server.ts",
    "../app/routes/dashboard.tsx",
    "../app/routes/focus.tsx",
  ];
  for (const rel of files) {
    const hits = dataDestructuresWithoutError(read(rel));
    expect(hits, `${rel} has { data: without error: ${hits.join(" | ")}`).toEqual([]);
  }
});

test("SyncDeps constructors set errorSource", () => {
  expect(read("../app/lib/qbo-cron.server.ts")).toContain('errorSource: "cron"');
  expect(read("../app/routes/auth.qbo.callback.tsx")).toContain('errorSource: "manual"');
  expect(read("../app/routes/api.qbo.refresh.tsx")).toContain('errorSource: "manual"');
  expect(read("../app/routes/webhooks.qbo.tsx")).toContain('errorSource: "webhook"');
});

test("CDC catch-up rethrows recon so last_cdc_time is not stamped", () => {
  const src = read("../app/lib/qbo-sync.server.ts");
  const recon = src.slice(src.indexOf("await applyCaseReconciliation"));
  expect(recon).toContain("recordSyncError");
  expect(recon).toContain('scope: "recon"');
  expect(recon).toContain("resolveSyncErrors");
  expect(recon).toContain("throw e");
  const cdc = src.slice(src.indexOf("export async function runCdcCatchup"));
  expect(cdc.indexOf("throw e")).toBeGreaterThan(-1);
  expect(cdc.indexOf("throw e")).toBeLessThan(cdc.indexOf("last_cdc_time: fetchedAt"));
  expect(cdc).toContain("if (cdcCursorErr) throw cdcCursorErr");
  expect(cdc).toContain("QUERY_LIMIT");
});

test("inner apply re-pull and eval rethrow; notify stays non-fatal", () => {
  const src = read("../app/lib/qbo-sync.server.ts");
  const apply = src.slice(
    src.indexOf("export async function applyPaymentsAndEvaluate"),
    src.indexOf("export async function applyPaymentWebhook"),
  );
  expect(apply).not.toContain("payment re-pull failed");
  expect(apply).not.toContain("promise evaluation failed (payments)");
  expect(apply).toContain("broken-promise notification failed (non-fatal)");
  expect(apply).toContain("throw e");
});

test("syncOverdueInvoices and applyInvoiceWebhook do not swallow recon", () => {
  const src = read("../app/lib/qbo-sync.server.ts");
  const overdue = src.slice(
    src.indexOf("export async function syncOverdueInvoices"),
    src.indexOf("export async function applyCustomerWebhook"),
  );
  expect(overdue).toContain("applyPaymentsAndEvaluate");
  expect(overdue).not.toContain("cron will re-converge");
  const inv = src.slice(
    src.indexOf("export async function applyInvoiceWebhook"),
    src.indexOf("// --- CDC catch-up"),
  );
  expect(inv).toContain("applyPaymentsAndEvaluate");
  expect(inv).not.toContain("cron will re-converge");
});

test("sync pages Intuit queries and does not advance truncated CDC (NP-AUD-2026-028)", () => {
  const src = read("../app/lib/qbo-sync.server.ts");
  expect(src).toContain("qboQueryAll");
  expect(src).toContain("CDC truncated");
  const api = read("../app/lib/qbo-api.server.ts");
  expect(api).toContain("truncated: true");
  expect(api).toContain("QBO_QUERY_MAX_PAGES");
});

test("first-connect heal backfills before CDC and skips CDC on backfill failure", () => {
  const src = read("../app/lib/qbo-cron.server.ts");
  expect(src).toContain("syncOverdueInvoices");
  expect(src).toContain('scope: "backfill"');
  expect(src).toContain("continue");
  const query = src.slice(src.indexOf("pageAll"));
  expect(query).toContain("last_sync_at");
});

test("inbound email routing includes disabled from-addresses and treats multiples as ambiguous", () => {
  const src = read("../app/lib/email-messaging.server.ts");
  const inbound = src.slice(
    src.indexOf("export async function recordInboundEmail"),
    src.indexOf("async function persistEmailOrphan"),
  );
  expect(inbound).toContain("from_address_norm");
  expect(inbound).toContain("length !== 1");
  expect(inbound).not.toContain('.eq("email_enabled", true)');
});

test("orphan STOP alerts only after the inbound_orphans insert succeeds", () => {
  const src = read("../app/lib/twilio-messaging.server.ts");
  const persist = src.slice(
    src.indexOf("async function persistOrphan"),
    src.indexOf("async function applyKeywordByPhone"),
  );
  expect(persist).toMatch(/if \(error &&[\s\S]*23505[\s\S]*throw error/);
  expect(persist).toMatch(/if \(!error && args\.keyword === "stop"\)/);
});
