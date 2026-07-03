import { useLoaderData, useNavigation, useSearchParams, Form, data, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv, getTwilioEnvOrNull, getEmailEnvOrNull, getPublicBaseUrls } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { AppShell } from "../components/AppShell";
import { SettingsTabs, resolveSettingsTab, settingsReturnTo } from "../components/SettingsTabs";
import { CollectionsRulesForm } from "../components/CollectionsRulesForm";
import { SmsSettingsSection } from "../components/SmsSettingsSection";
import { EmailSettingsSection } from "../components/EmailSettingsSection";
import { LateFeesForm } from "../components/LateFeesForm";
import { PriorityThresholdsForm } from "../components/PriorityThresholdsForm";
import { WorkflowSettingsForm } from "../components/WorkflowSettingsForm";
import { NotificationPrefsForm } from "../components/NotificationPrefsForm";
import { CompanyProfileForm } from "../components/CompanyProfileForm";
import { TemplateEditor } from "../components/TemplateEditor";
import { resolveChannelSettings, resolveSmsSenderSettings } from "../lib/channel-settings";
import { resolveEmailSettings } from "../lib/email-settings";
import { deriveWebhookUrls } from "../lib/provider-status";
import { loadTemplates } from "../lib/message-templates.server";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => pageTitle("Settings");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const {
    supabase, headers, isOwner, org, user,
    orgName, initials, connected, lastSyncAt,
  } = await loadWorkspaceChrome(request, env, { requireQbo: false });

  const { data: syncErrorRows } = await supabase.from("sync_errors")
    .select("id, source, scope, message, occurred_at").eq("org_id", org.org_id)
    .is("resolved_at", null).order("occurred_at", { ascending: false }).limit(20);
  const syncIssues = ((syncErrorRows as any[]) ?? []).map((r) => ({
    id: r.id as string, source: r.source as string, scope: r.scope as string,
    message: r.message as string, occurredAt: r.occurred_at as string,
  }));

  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid, sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const senderSettings = resolveSmsSenderSettings(msg as any);
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);
  const smsEnabled = resolveChannelSettings(msg as { sms_enabled?: boolean | null } | null).smsEnabled;

  const { data: emailConfigRow } = await supabase.from("email_config")
    .select("email_enabled, from_address, from_name, postal_address").eq("org_id", org.org_id).maybeSingle();
  const emailSettings = resolveEmailSettings(emailConfigRow as any);

  const config = await loadOrgConfig(supabase, org.org_id);

  const displayName = (user.user_metadata?.display_name as string | undefined) ?? "";

  // Notification prefs (user client → RLS enforces self-only)
  const { data: notifPrefs } = await supabase
    .from("user_notification_prefs")
    .select("broken_promise_email, daily_digest_email")
    .eq("org_id", org.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Provider status: env booleans (NEVER leak secret values), webhook URLs,
  // last-sent timestamps, and failure counts for the status panels.
  const twilioConfigured = getTwilioEnvOrNull(context as any) !== null;
  const resendConfigured = getEmailEnvOrNull(context as any) !== null;
  const { twilioBaseUrl, appBaseUrl } = getPublicBaseUrls(context as any);
  const webhookUrls = deriveWebhookUrls(twilioBaseUrl, appBaseUrl);

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [smsLast, smsFailures, emailLast, emailFailures, templates] = await Promise.all([
    supabase.from("text_messages")
      .select("created_at, status").eq("org_id", org.org_id).eq("direction", "outbound")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("text_messages")
      .select("id", { count: "exact", head: true }).eq("org_id", org.org_id).eq("direction", "outbound")
      .in("status", ["failed", "undelivered"]).gte("created_at", since),
    supabase.from("email_messages")
      .select("created_at, status").eq("org_id", org.org_id).eq("direction", "outbound")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("email_messages")
      .select("id", { count: "exact", head: true }).eq("org_id", org.org_id).eq("direction", "outbound")
      .in("status", ["bounced", "complained"]).gte("created_at", since),
    loadTemplates(supabase, org.org_id),
  ]);

  return data({
    orgName,
    orgId: org.org_id,
    displayName,
    ownerEmail: user.email ?? "",
    initials, isOwner, connected, lastSyncAt, syncIssues,
    messaging: {
      sender: senderSettings.sender,
      messagingServiceSid: senderSettings.messagingServiceSid,
      configured: messagingConfigured,
      smsEnabled,
    },
    emailSettings,
    rules: {
      grace: config.promiseGraceDays,
      workingDays: [...config.workingDays],
      cadence: config.cadenceDays,
      holidays: [...config.holidays].sort(),
    },
    lateFee: config.lateFee,
    companyProfile: config.companyProfile,
    digestHourLocal: config.digestHourLocal,
    priority: config.priority,
    workflow: config.workflow,
    smsTemplates: templates.sms,
    emailTemplates: templates.email,
    notificationPrefs: {
      brokenPromiseEmail: notifPrefs?.broken_promise_email ?? true,
      dailyDigestEmail: notifPrefs?.daily_digest_email ?? true,
    },
    providerStatus: {
      twilioConfigured,
      resendConfigured,
      webhookUrls,
      sms: {
        lastSentAt: (smsLast.data?.created_at as string | null) ?? null,
        lastStatus: (smsLast.data?.status as string | null) ?? null,
        failures7d: smsFailures.count ?? 0,
      },
      email: {
        lastSentAt: (emailLast.data?.created_at as string | null) ?? null,
        lastStatus: (emailLast.data?.status as string | null) ?? null,
        failures7d: emailFailures.count ?? 0,
      },
    },
  }, { headers });
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h ago` : `${Math.floor(hr / 24)}d ago`;
}

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const tab = resolveSettingsTab(sp.get("tab"));
  const returnTo = settingsReturnTo(tab);
  const syncLabel = d.connected ? `Synced ${relTime(d.lastSyncAt)}` : "Not connected";
  const navigation = useNavigation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;

  useFlashCleanup();

  const ps = d.providerStatus;

  return (
    <AppShell orgName={d.orgName} userInitials={d.initials} syncLabel={syncLabel} connected={d.connected} isOwner={d.isOwner} activeNav="settings">
      <div className="h-full overflow-auto bg-panel p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <h1 className="font-display text-xl font-semibold text-text">Settings</h1>
          <SettingsTabs />

          {/* ── Workspace tab ────────────────────────────────────── */}
          {tab === "workspace" && (
            <>
              {/* Profile (display name) */}
              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-display text-base font-semibold text-text">Profile</h2>
                <Form method="post" action="/api/profile" className="mt-3 flex items-end gap-3">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="flex-1 grid gap-1 text-sm font-medium text-text">
                    Display name
                    <input
                      name="display_name" type="text" required maxLength={80} defaultValue={d.displayName}
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <button
                    type="submit" disabled={formBusy("/api/profile")}
                    className="h-9 rounded-md bg-copper px-4 text-sm font-medium text-white hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {formBusy("/api/profile") ? "Saving…" : "Save"}
                  </button>
                </Form>
                {sp.get("saved") === "profile" && <p className="mt-2 text-xs text-cool">Name updated.</p>}
                <p className="mt-2 text-xs text-muted">Your display name appears in contact logs, owner assignments, and reports.</p>
              </section>

              {/* Company profile */}
              <CompanyProfileForm
                key={d.orgId}
                orgName={d.orgName}
                profile={d.companyProfile}
                digestHourLocal={d.digestHourLocal}
                isOwner={d.isOwner}
                returnTo={returnTo}
              />

              {/* Notifications */}
              <NotificationPrefsForm
                key={d.orgId}
                orgId={d.orgId}
                emailEnabled={d.emailSettings.emailEnabled}
                prefs={d.notificationPrefs}
              />
            </>
          )}

          {/* ── Integrations tab ─────────────────────────────────── */}
          {tab === "integrations" && (
            <>
              {/* QuickBooks connection */}
              <section className="rounded-lg border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-text">QuickBooks</h2>
                  <span className={`text-xs font-medium ${d.connected ? "text-cool" : "text-muted"}`} suppressHydrationWarning>
                    {d.connected ? `Connected · ${syncLabel}` : "Not connected"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.connected ? (
                    <>
                      <Form method="post" action="/api/qbo/refresh">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" disabled={formBusy("/api/qbo/refresh")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper disabled:opacity-60 disabled:cursor-not-allowed">
                          {formBusy("/api/qbo/refresh") ? "Refreshing…" : "Refresh"}
                        </button>
                      </Form>
                      {d.isOwner ? (
                        <>
                          <Form method="post" action="/api/qbo/connect">
                            <button type="submit" disabled={formBusy("/api/qbo/connect")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper disabled:opacity-60 disabled:cursor-not-allowed">
                              {formBusy("/api/qbo/connect") ? "Reconnecting…" : "Reconnect"}
                            </button>
                          </Form>
                          <Form method="post" action="/api/qbo/disconnect">
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <button type="submit" disabled={formBusy("/api/qbo/disconnect")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-hot hover:border-hot disabled:opacity-60 disabled:cursor-not-allowed">
                              {formBusy("/api/qbo/disconnect") ? "Disconnecting…" : "Disconnect"}
                            </button>
                          </Form>
                        </>
                      ) : null}
                    </>
                  ) : d.isOwner ? (
                    <Form method="post" action="/api/qbo/connect">
                      <button type="submit" disabled={formBusy("/api/qbo/connect")} className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed">
                        {formBusy("/api/qbo/connect") ? "Connecting…" : "Connect QuickBooks"}
                      </button>
                    </Form>
                  ) : (
                    <p className="text-sm text-muted">Not connected — ask an owner to connect QuickBooks.</p>
                  )}
                </div>
              </section>

              {/* Sync health */}
              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-display text-base font-semibold text-text">Sync health</h2>
                <p className="mt-0.5 text-xs text-muted">Last sync <span suppressHydrationWarning>{relTime(d.lastSyncAt)}</span> · {d.syncIssues.length} unresolved {d.syncIssues.length === 1 ? "error" : "errors"}.</p>
                <ul className="mt-3 flex flex-col gap-2" role="list">
                  {d.syncIssues.map((it) => (
                    <li key={it.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium capitalize text-text">{it.source}</span>
                        <span className="text-muted" suppressHydrationWarning>{relTime(it.occurredAt)}</span>
                      </div>
                      <p className="mt-0.5 break-words text-text/80">{it.message}</p>
                      <Form method="post" action="/api/sync-errors/dismiss" className="mt-1.5">
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" disabled={formBusy("/api/sync-errors/dismiss")} className="text-[11px] font-medium text-copper hover:underline disabled:opacity-60 disabled:cursor-not-allowed">
                          {formBusy("/api/sync-errors/dismiss") ? "Dismissing…" : "Dismiss"}
                        </button>
                      </Form>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {/* ── Channels tab ─────────────────────────────────────── */}
          {tab === "channels" && (
            <>
              <SmsSettingsSection
                key={d.orgId}
                isOwner={d.isOwner}
                smsEnabled={d.messaging.smsEnabled}
                sender={d.messaging.sender}
                messagingServiceSid={d.messaging.messagingServiceSid}
                configured={d.messaging.configured}
                twilioConfigured={ps.twilioConfigured}
                lastSentAt={relTime(ps.sms.lastSentAt)}
                lastStatus={ps.sms.lastStatus}
                failures7d={ps.sms.failures7d}
                twilioInbound={ps.webhookUrls.twilioInbound}
                twilioStatus={ps.webhookUrls.twilioStatus}
                returnTo={returnTo}
              />
              <EmailSettingsSection
                key={d.orgId}
                isOwner={d.isOwner}
                emailEnabled={d.emailSettings.emailEnabled}
                fromAddress={d.emailSettings.fromAddress}
                fromName={d.emailSettings.fromName}
                postalAddress={d.emailSettings.postalAddress}
                ownerEmail={d.ownerEmail}
                resendConfigured={ps.resendConfigured}
                lastSentAt={relTime(ps.email.lastSentAt)}
                lastStatus={ps.email.lastStatus}
                failures7d={ps.email.failures7d}
                resendWebhook={ps.webhookUrls.resendWebhook}
                returnTo={returnTo}
              />
            </>
          )}

          {/* ── Templates tab ────────────────────────────────────── */}
          {tab === "templates" && (
            <TemplateEditor
              key={d.orgId}
              smsTemplates={d.smsTemplates}
              emailTemplates={d.emailTemplates}
              isOwner={d.isOwner}
              returnTo={returnTo}
              orgId={d.orgId}
            />
          )}

          {/* ── Collections tab ──────────────────────────────────── */}
          {tab === "collections" && (
            <>
              <CollectionsRulesForm
                grace={d.rules.grace}
                workingDays={d.rules.workingDays}
                cadence={d.rules.cadence}
                holidays={d.rules.holidays}
                isOwner={d.isOwner}
                returnTo={returnTo}
              />
              {d.isOwner && <LateFeesForm key={d.orgId} lateFee={d.lateFee} returnTo={returnTo} />}
              {d.isOwner && <PriorityThresholdsForm key={d.orgId} priority={d.priority} returnTo={returnTo} />}
              {d.isOwner && <WorkflowSettingsForm key={d.orgId} workflow={d.workflow} returnTo={returnTo} />}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
