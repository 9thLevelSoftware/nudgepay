import { redirect, useLoaderData, useNavigation, useSearchParams, Form, data, type LoaderFunctionArgs } from "react-router";
import { useFlashCleanup } from "../lib/use-flash-cleanup";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { AppShell } from "../components/AppShell";
import { CollectionsRulesForm } from "../components/CollectionsRulesForm";
import { resolveChannelSettings } from "../lib/channel-settings";
import { resolveEmailSettings } from "../lib/email-settings";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => pageTitle("Settings");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const isOwner = org.role === "owner";

  const { data: orgRow } = await supabase.from("organizations").select("name").eq("id", org.org_id).single();
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials = emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

  const conn = await getConnectionStatus(supabase, org.org_id);
  const connected = conn?.status === "connected";

  const { data: connMeta } = await supabase.from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;

  const { data: syncErrorRows } = await supabase.from("sync_errors")
    .select("id, source, scope, message, occurred_at").eq("org_id", org.org_id)
    .is("resolved_at", null).order("occurred_at", { ascending: false }).limit(20);
  const syncIssues = ((syncErrorRows as any[]) ?? []).map((r) => ({
    id: r.id as string, source: r.source as string, scope: r.scope as string,
    message: r.message as string, occurredAt: r.occurred_at as string,
  }));

  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid, sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const sender = (msg?.sender as string | null) ?? null;
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);
  const smsEnabled = resolveChannelSettings(msg as { sms_enabled?: boolean | null } | null).smsEnabled;

  const { data: emailConfigRow } = await supabase.from("email_config")
    .select("email_enabled, from_address, from_name, postal_address").eq("org_id", org.org_id).maybeSingle();
  const emailSettings = resolveEmailSettings(emailConfigRow as any);

  const config = await loadOrgConfig(supabase, org.org_id);

  return data({
    orgName: (orgRow?.name as string) ?? "Workspace",
    initials, isOwner, connected, lastSyncAt, syncIssues,
    messaging: { sender, configured: messagingConfigured, smsEnabled },
    emailSettings,
    rules: {
      grace: config.promiseGraceDays,
      workingDays: [...config.workingDays],
      cadence: config.cadenceDays,
      holidays: [...config.holidays].sort(),
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
  const saved = sp.get("email_saved") === "1";
  const errorCode = sp.get("error");
  const syncLabel = d.connected ? `Synced ${relTime(d.lastSyncAt)}` : "Not connected";
  const navigation = useNavigation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;
  const intentBusy = (intent: string) =>
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === intent;

  useFlashCleanup();

  return (
    <AppShell orgName={d.orgName} userInitials={d.initials} syncLabel={syncLabel} connected={d.connected} isOwner={d.isOwner}>
      <div className="h-full overflow-auto bg-panel p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <h1 className="font-display text-xl font-semibold text-text">Settings</h1>

          {/* QuickBooks connection (G1) */}
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
                    <input type="hidden" name="returnTo" value="/settings" />
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
                        <input type="hidden" name="returnTo" value="/settings" />
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

          {/* Sync health (G3) */}
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
                    <input type="hidden" name="returnTo" value="/settings" />
                    <button type="submit" disabled={formBusy("/api/sync-errors/dismiss")} className="text-[11px] font-medium text-copper hover:underline disabled:opacity-60 disabled:cursor-not-allowed">
                      {formBusy("/api/sync-errors/dismiss") ? "Dismissing…" : "Dismiss"}
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>

          {/* Text messaging (G2 sender read-only; Phase 14 SMS toggle) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-text">Text messaging</h2>
              {d.isOwner ? (
                <Form method="post" action="/api/org-settings">
                  <input type="hidden" name="intent" value="save_channels" />
                  <input type="hidden" name="returnTo" value="/settings" />
                  <label className="sr-only" htmlFor="sms-enabled">SMS enabled</label>
                  <select
                    id="sms-enabled" name="sms_enabled" defaultValue={d.messaging.smsEnabled ? "true" : "false"}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    disabled={intentBusy("save_channels")}
                    className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </Form>
              ) : (
                <span className={`text-xs font-medium ${d.messaging.smsEnabled ? "text-cool" : "text-muted"}`}>
                  {d.messaging.smsEnabled ? "On" : "Off"}
                </span>
              )}
            </div>
            <dl className="mt-2 flex flex-col gap-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted w-28">From</dt><dd className="text-text tabular-nums">{d.messaging.sender ?? "Not yet assigned"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted w-28">Status</dt><dd className={d.messaging.configured ? "text-cool" : "text-muted"}>{d.messaging.configured ? "Set up" : "Setup in progress — managed by NudgePay"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Text-message carrier registration is managed by NudgePay.</p>
            {d.messaging.smsEnabled && !d.messaging.configured ? (
              <p className="mt-1 text-xs text-muted">Texting turns on automatically once your number is assigned.</p>
            ) : null}
            {!d.messaging.smsEnabled ? (
              <p className="mt-1 text-xs text-hot">Outbound texts are turned off — composers are disabled and sends are blocked.</p>
            ) : null}
          </section>

          {/* Email (Phase 15) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-text">Email</h2>
              <span className={`text-xs font-medium ${d.emailSettings.emailEnabled ? "text-cool" : "text-muted"}`}>
                {d.emailSettings.emailEnabled ? "On" : "Off"}
              </span>
            </div>
            {d.isOwner ? (
              <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="intent" value="save_email" />
                <input type="hidden" name="returnTo" value="/settings" />
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    name="email_enabled"
                    value="true"
                    defaultChecked={d.emailSettings.emailEnabled}
                    className="h-4 w-4 rounded border-border accent-copper"
                  />
                  Enable email
                </label>
                <div className="flex flex-col gap-1">
                  <label htmlFor="from-address" className="text-xs font-medium text-muted">From address</label>
                  <input
                    id="from-address"
                    type="email"
                    name="from_address"
                    defaultValue={d.emailSettings.fromAddress}
                    placeholder="billing@yourdomain.com"
                    className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                  />
                  <p className="text-xs text-muted">Must be on a domain you've verified with Resend (SPF/DKIM)</p>
                  {errorCode === "email" ? (
                    <p className="text-xs text-hot" role="alert">Enter a valid from address</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="from-name" className="text-xs font-medium text-muted">From name</label>
                  <input
                    id="from-name"
                    name="from_name"
                    defaultValue={d.emailSettings.fromName}
                    placeholder="Your business name"
                    className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="postal-address" className="text-xs font-medium text-muted">Business mailing address</label>
                  <textarea
                    id="postal-address"
                    name="postal_address"
                    defaultValue={d.emailSettings.postalAddress}
                    placeholder="123 Main St, Suite 100, City, ST 00000"
                    rows={2}
                    className="rounded-md border border-border bg-panel px-2 py-1 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                  />
                  <p className="text-xs text-muted">Required by CAN-SPAM — appended to every email's footer.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={intentBusy("save_email")} className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed">
                    {intentBusy("save_email") ? "Saving…" : "Save"}
                  </button>
                  {saved ? <span className="text-xs text-cool" role="status">Saved.</span> : null}
                </div>
              </Form>
            ) : (
              <dl className="mt-2 flex flex-col gap-1 text-sm">
                <div className="flex gap-2"><dt className="text-muted w-28">Status</dt><dd className={d.emailSettings.emailEnabled ? "text-cool" : "text-muted"}>{d.emailSettings.emailEnabled ? "On" : "Off"}</dd></div>
                <div className="flex gap-2"><dt className="text-muted w-28">From</dt><dd className="text-text">{d.emailSettings.fromAddress || "Not configured"}</dd></div>
              </dl>
            )}
          </section>

          {/* Collections rules (C7) */}
          <CollectionsRulesForm grace={d.rules.grace} workingDays={d.rules.workingDays} cadence={d.rules.cadence} holidays={d.rules.holidays} isOwner={d.isOwner} />
        </div>
      </div>
    </AppShell>
  );
}
