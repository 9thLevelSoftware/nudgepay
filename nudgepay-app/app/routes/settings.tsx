import { useRef, useState } from "react";
import { useLoaderData, useNavigation, useSearchParams, Form, data, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { useDialog } from "../lib/use-dialog";
import { orgNameMatches } from "../lib/qbo-disconnect";
import { DELETE_CONFIRM_TOKEN, deletionConfirmMatches, isLastOwnerMember } from "../lib/account-deletion";
import { getEnv, getTwilioEnvOrNull, getEmailEnvOrNull, getPublicBaseUrls, getQboEnvOrNull } from "../lib/env.server";
import { loadWorkspaceChrome } from "../lib/workspace.server";
import { listOrgMembers } from "../lib/orgs.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { QBO_FLASH, SYNC_FLASH } from "../lib/flash-copy";
import { AppShell } from "../components/AppShell";
import { FlashBanner } from "../components/FlashBanner";
import { SyncIssues } from "../components/SyncIssues";
import { SettingsTabs, SettingsDirtyProvider, resolveSettingsTab, settingsReturnTo } from "../components/SettingsTabs";
import { CollectionsRulesForm } from "../components/CollectionsRulesForm";
import { SmsSettingsSection } from "../components/SmsSettingsSection";
import { EmailSettingsSection } from "../components/EmailSettingsSection";
import { LateFeesForm } from "../components/LateFeesForm";
import { PriorityThresholdsForm } from "../components/PriorityThresholdsForm";
import { WorkflowSettingsForm } from "../components/WorkflowSettingsForm";
import { QuietHoursForm } from "../components/QuietHoursForm";
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
    supabase, service, headers, isOwner, org, user,
    orgName, initials, userLabel, connected, lastSyncAt, syncIssues,
  } = await loadWorkspaceChrome(request, env, { requireQbo: false });

  const qboConfigured = getQboEnvOrNull(context as any) !== null;
  const sp = new URL(request.url).searchParams;

  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid, sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const senderSettings = resolveSmsSenderSettings(msg as any);
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);
  const smsEnabled = resolveChannelSettings(msg as { sms_enabled?: boolean | null } | null).smsEnabled;

  const { data: emailConfigRow } = await supabase.from("email_config")
    .select("email_enabled, from_address, from_name, postal_address").eq("org_id", org.org_id).maybeSingle();
  const emailSettings = resolveEmailSettings(emailConfigRow as any);

  const config = await loadOrgConfig(supabase, org.org_id);

  // Display-only holiday rows (date + label). resolveOrgConfig's holidays Set
  // (used for business-day math) only needs the dates, so this is a separate,
  // lightweight read rather than threading label through OrgConfig.
  const { data: holidayRows, error: holidayErr } = await supabase.from("org_holidays")
    .select("holiday_date, label").eq("org_id", org.org_id).order("holiday_date", { ascending: true });
  if (holidayErr) throw holidayErr;

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
  const [smsLast, smsFailures, emailLast, emailFailures, templates, members, inviteRows] = await Promise.all([
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
    loadTemplates(supabase, org.org_id).catch(() => ({ sms: [], email: [] })),
    listOrgMembers(service, org.org_id),
    supabase.from("invites")
      .select("id, email, expires_at, created_at")
      .eq("org_id", org.org_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return data({
    orgName,
    orgId: org.org_id,
    currentUserId: user.id,
    displayName,
    ownerEmail: user.email ?? "",
    initials, userLabel, isOwner, connected, lastSyncAt, syncIssues,
    qboConfigured,
    qboRedirectHint: appBaseUrl
      ? `${appBaseUrl.replace(/\/$/, "")}/auth/qbo/callback`
      : "/auth/qbo/callback",
    qboFlash: sp.get("qbo"),
    syncFlash: sp.get("sync"),
    members,
    pendingInvites: ((inviteRows.data as { id: string; email: string; expires_at: string; created_at: string }[] | null) ?? [])
      .map((r) => ({ id: r.id, email: r.email, expiresAt: r.expires_at })),
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
      holidays: ((holidayRows as { holiday_date: string; label: string | null }[] | null) ?? [])
        .map((h) => ({ date: h.holiday_date, label: h.label ?? null })),
    },
    lateFee: config.lateFee,
    companyProfile: config.companyProfile,
    digestHourLocal: config.digestHourLocal,
    quietHours: config.quietHours,
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

function InviteLinkStatus({ link, sent }: { link: string; sent: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — link is still selectable */ }
  };
  return (
    <p className="mt-3 text-sm text-cool" role="status">
      {sent
        ? "Invite email sent. Link (expires in 14 days): "
        : "Invite created. Copy this link (expires in 14 days): "}
      <code className="break-all rounded bg-panel px-1.5 py-0.5 text-xs text-text">{link}</code>
      <button
        type="button"
        onClick={copy}
        className="ml-2 shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text hover:border-copper"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const tab = resolveSettingsTab(sp.get("tab"));
  const returnTo = settingsReturnTo(tab);
  const syncLabel = d.connected ? `Synced ${relTime(d.lastSyncAt)}` : "Not connected";
  const navigation = useNavigation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;
  const profileBusy = (intent: string) =>
    navigation.state !== "idle" &&
    navigation.formAction === "/api/profile" &&
    navigation.formData?.get("intent") === intent;

  useFlashCleanup();

  const ps = d.providerStatus;

  const inviteLink = sp.get("invite_link");
  const memberError = sp.get("error");
  const ownerCount = d.members.filter((m) => m.role === "owner").length;
  const lastOwner = isLastOwnerMember(d.isOwner, ownerCount);
  const canLeave = !lastOwner;

  return (
    <AppShell
      orgName={d.orgName}
      userInitials={d.initials}
      userLabel={d.userLabel}
      syncLabel={syncLabel}
      connected={d.connected}
      isOwner={d.isOwner}
      activeNav="settings"
      syncIssues={<SyncIssues issues={d.syncIssues} returnTo={returnTo} />}
    >
      {d.qboFlash && QBO_FLASH[d.qboFlash] ? (
        <FlashBanner tone={QBO_FLASH[d.qboFlash].tone} text={QBO_FLASH[d.qboFlash].text} />
      ) : null}
      {d.syncFlash && SYNC_FLASH[d.syncFlash] ? (
        <FlashBanner tone={SYNC_FLASH[d.syncFlash].tone} text={SYNC_FLASH[d.syncFlash].text} />
      ) : null}
      <div className="h-full overflow-auto bg-panel p-6">
        <SettingsDirtyProvider
          resetKey={`${tab}:${sp.get("saved") ?? ""}:${sp.get("email_saved") ?? ""}:${sp.get("sms_saved") ?? ""}`}
        >
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
                  <input type="hidden" name="intent" value="profile" />
                  <label className="flex-1 grid gap-1 text-sm font-medium text-text">
                    Display name
                    <input
                      name="display_name" type="text" required maxLength={80} defaultValue={d.displayName}
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <button
                    type="submit" disabled={profileBusy("profile")}
                    className="h-9 rounded-md bg-copper px-4 text-sm font-medium text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {profileBusy("profile") ? "Saving…" : "Save"}
                  </button>
                </Form>
                {sp.get("saved") === "profile" && <p className="mt-2 text-xs text-cool">Name updated.</p>}
                <p className="mt-2 text-xs text-muted">Your display name appears in contact logs, owner assignments, and reports.</p>
              </section>

              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-display text-base font-semibold text-text">Password</h2>
                <p className="mt-0.5 text-xs text-muted">Change the password you use to sign in. Requires your current password.</p>
                <Form method="post" action="/api/profile" className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="intent" value="password" />
                  <label className="grid gap-1 text-sm font-medium text-text">
                    Current password
                    <input
                      name="current_password" type="password" required autoComplete="current-password"
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-text">
                    New password
                    <input
                      name="new_password" type="password" required minLength={8} autoComplete="new-password"
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-text">
                    Confirm new password
                    <input
                      name="confirm_password" type="password" required minLength={8} autoComplete="new-password"
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <button
                    type="submit" disabled={profileBusy("password")}
                    className="h-9 w-fit rounded-md bg-copper px-4 text-sm font-medium text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {profileBusy("password") ? "Updating…" : "Update password"}
                  </button>
                </Form>
                {sp.get("saved") === "password" ? (
                  <p className="mt-2 text-xs text-cool" role="status">Password updated.</p>
                ) : null}
                {sp.get("error") === "password" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">
                    Could not change password. Use at least 8 characters, different from your current password, and make sure they match.
                  </p>
                ) : null}
                {sp.get("error") === "wrong-password" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">Current password is incorrect.</p>
                ) : null}
              </section>

              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-display text-base font-semibold text-text">Email</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Current address: <span className="font-medium text-text">{d.ownerEmail || "not set"}</span>.
                  We send a confirmation to the new address; this stays current until you confirm.
                </p>
                <Form method="post" action="/api/profile" className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="intent" value="email" />
                  <label className="grid gap-1 text-sm font-medium text-text">
                    New email
                    <input
                      name="new_email" type="email" required autoComplete="email"
                      className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                    />
                  </label>
                  <button
                    type="submit" disabled={profileBusy("email")}
                    className="h-9 w-fit rounded-md bg-copper px-4 text-sm font-medium text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {profileBusy("email") ? "Sending…" : "Change email"}
                  </button>
                </Form>
                {sp.get("saved") === "email" ? (
                  <p className="mt-2 text-xs text-cool" role="status">Check your inbox to confirm the new email</p>
                ) : null}
                {sp.get("error") === "email" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">Enter a valid email address different from your current one.</p>
                ) : null}
              </section>

              <DeleteAccountForm
                currentEmail={d.ownerEmail}
                lastOwner={lastOwner}
                returnTo={returnTo}
                busy={profileBusy("delete")}
                error={sp.get("error")}
              />

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
                alertsReady={Boolean(d.providerStatus.resendConfigured && d.emailSettings.fromAddress)}
                prefs={d.notificationPrefs}
              />

              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="font-display text-base font-semibold text-text">Workspace members</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Owners can invite teammates and change roles. The last owner cannot leave or be removed.
                </p>
                <ul className="mt-3 flex flex-col gap-2" role="list">
                  {d.members.map((m) => (
                    <li key={m.userId} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
                      <span className="font-medium text-text">{m.label}</span>
                      <span className="text-xs text-muted">{m.email}</span>
                      <span className="text-xs capitalize text-muted">{m.role}</span>
                      {d.isOwner && m.userId !== d.currentUserId ? (
                        <>
                          <Form method="post" action="/api/members" className="ml-auto flex items-center gap-2">
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="intent" value="role" />
                            <input type="hidden" name="userId" value={m.userId} />
                            <label className="grid gap-0.5 text-[11px] font-medium text-muted">
                              Role
                              <select
                                name="role"
                                defaultValue={m.role}
                                className="h-8 rounded-md border border-border bg-panel px-2 text-xs text-text"
                              >
                                <option value="member">Member</option>
                                <option value="owner">Owner</option>
                              </select>
                            </label>
                            <button type="submit" className="text-xs font-medium text-copper hover:underline">
                              Update
                            </button>
                          </Form>
                          <Form method="post" action="/api/members">
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="intent" value="remove" />
                            <input type="hidden" name="userId" value={m.userId} />
                            <button type="submit" className="text-xs font-medium text-hot hover:underline">
                              Remove
                            </button>
                          </Form>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {d.pendingInvites.length > 0 ? (
                  <div className="mt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Pending invites</h3>
                    <ul className="mt-1 flex flex-col gap-1" role="list">
                      {d.pendingInvites.map((inv) => (
                        <li key={inv.id} className="text-xs text-muted">
                          {inv.email}
                          {inv.expiresAt ? ` · expires ${inv.expiresAt.slice(0, 10)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {d.isOwner ? (
                  <Form method="post" action="/api/members" className="mt-4 flex items-end gap-3">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="intent" value="invite" />
                    <label className="flex-1 grid gap-1 text-sm font-medium text-text">
                      Invite email
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="teammate@company.com"
                        className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={formBusy("/api/members")}
                      className="h-9 rounded-md bg-copper px-4 text-sm font-medium text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {formBusy("/api/members") ? "Creating…" : "Create invite link"}
                    </button>
                  </Form>
                ) : null}
                {inviteLink ? (
                  <InviteLinkStatus link={inviteLink} sent={sp.get("invite_sent") === "1"} />
                ) : null}
                {sp.get("saved") === "member" ? (
                  <p className="mt-2 text-xs text-cool" role="status">Member updated.</p>
                ) : null}
                {memberError === "forbidden" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">Only owners can manage members.</p>
                ) : null}
                {memberError === "invite" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">Could not create that invite. Check the email and try again.</p>
                ) : null}
                {memberError === "member" ? (
                  <p className="mt-2 text-xs text-hot" role="alert">Could not change membership. The last owner cannot be removed or demoted.</p>
                ) : null}
                {canLeave ? (
                  <Form method="post" action="/api/members" className="mt-4">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="intent" value="leave" />
                    <button type="submit" className="text-xs font-medium text-hot hover:underline">
                      Leave workspace
                    </button>
                  </Form>
                ) : (
                  <p className="mt-4 text-xs text-muted">The last owner cannot leave the workspace.</p>
                )}
              </section>
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
                <p className="mt-0.5 text-xs text-muted">US companies billed in USD only.</p>
                {!d.qboConfigured ? (
                  <p className="mt-3 text-sm text-muted">
                    QuickBooks is not configured on this server yet. An operator needs to set the QBO Worker
                    secrets (client ID, secret, redirect URI, encryption key, webhook verifier) and register
                    this Intuit redirect URI:{" "}
                    <code className="break-all rounded bg-panel px-1.5 py-0.5 text-xs text-text">{d.qboRedirectHint}</code>
                  </p>
                ) : null}
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
                          {d.qboConfigured ? (
                            <Form method="post" action="/api/qbo/connect">
                              <button type="submit" disabled={formBusy("/api/qbo/connect")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper disabled:opacity-60 disabled:cursor-not-allowed">
                                {formBusy("/api/qbo/connect") ? "Reconnecting…" : "Reconnect"}
                              </button>
                            </Form>
                          ) : null}
                          <QboDisconnectConfirm
                            orgName={d.orgName}
                            returnTo={returnTo}
                            busy={formBusy("/api/qbo/disconnect")}
                          />
                        </>
                      ) : null}
                    </>
                  ) : !d.qboConfigured ? null : d.isOwner ? (
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
              {d.isOwner && <QuietHoursForm key={d.orgId} quietHours={d.quietHours} returnTo={returnTo} />}
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
              orgCompany={d.orgName}
              orgPhone={d.companyProfile.phone ?? ""}
              orgPaymentLink={d.companyProfile.paymentPortalUrl ?? ""}
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
        </SettingsDirtyProvider>
      </div>
    </AppShell>
  );
}

function DeleteAccountForm({
  currentEmail,
  lastOwner,
  returnTo,
  busy,
  error,
}: {
  currentEmail: string;
  lastOwner: boolean;
  returnTo: string;
  busy: boolean;
  error: string | null;
}) {
  const [typed, setTyped] = useState("");
  const canSubmit = deletionConfirmMatches(typed, currentEmail);

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Delete account</h2>
      <p className="mt-0.5 text-xs text-muted">
        Removes you from this workspace and signs you out. Type your email or{" "}
        <span className="font-medium text-text">{DELETE_CONFIRM_TOKEN}</span> to confirm.
      </p>
      {lastOwner ? (
        <p className="mt-3 text-xs text-muted">
          The last owner cannot delete their account. Transfer ownership first.
        </p>
      ) : (
        <Form method="post" action="/api/profile" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="intent" value="delete" />
          <label className="grid gap-1 text-sm font-medium text-text">
            Confirm
            <input
              name="confirm"
              type="text"
              required
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <button
            type="submit"
            disabled={!canSubmit || busy}
            className="h-9 w-fit rounded-md border border-hot px-4 text-sm font-medium text-hot disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </Form>
      )}
      {error === "confirm" ? (
        <p className="mt-2 text-xs text-hot" role="alert">Type your email or DELETE to confirm.</p>
      ) : null}
      {error === "last-owner" ? (
        <p className="mt-2 text-xs text-hot" role="alert">The last owner cannot delete their account. Transfer ownership first.</p>
      ) : null}
      {error === "delete" ? (
        <p className="mt-2 text-xs text-hot" role="alert">Could not delete your account. Try again.</p>
      ) : null}
    </section>
  );
}

function QboDisconnectConfirm({
  orgName,
  returnTo,
  busy,
}: {
  orgName: string;
  returnTo: string;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    setTyped("");
  }

  const { panelRef } = useDialog({
    onClose: close,
    enabled: open,
    initialFocusRef: inputRef as React.RefObject<HTMLElement | null>,
  });

  const canSubmit = orgNameMatches(typed, orgName);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-hot hover:border-hot disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Disconnect
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qbo-disconnect-title"
          aria-describedby="qbo-disconnect-desc"
          className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink/40 p-4"
          onClick={close}
        >
          <div
            ref={panelRef}
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="qbo-disconnect-title" className="font-display text-base font-semibold text-text">
              Disconnect QuickBooks
            </h3>
            <p id="qbo-disconnect-desc" className="mt-1.5 text-sm text-muted">
              This stops invoice sync for this workspace. Type{" "}
              <span className="font-medium text-text">{orgName}</span> to confirm.
            </p>
            <Form method="post" action="/api/qbo/disconnect" className="mt-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <label className="grid gap-1 text-sm font-medium text-text">
                Workspace name
                <input
                  ref={inputRef}
                  name="confirm"
                  type="text"
                  required
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || busy}
                  className="rounded-md border border-hot px-3 py-1.5 text-xs font-medium text-hot disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </Form>
          </div>
        </div>
      ) : null}
    </>
  );
}
