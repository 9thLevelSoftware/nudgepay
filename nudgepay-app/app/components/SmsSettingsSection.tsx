import { Form, useNavigation, useSearchParams } from "react-router";
import { WebhookUrlField } from "./WebhookUrlField";

export type SmsSettingsProps = {
  isOwner: boolean;
  smsEnabled: boolean;
  sender: string;           // per-org from-number override (form default)
  messagingServiceSid: string; // per-org MG SID override (form default)
  configured: boolean;      // has at least one sender column set
  // Provider status
  twilioConfigured: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
  failures7d: number;
  // Webhook URLs
  twilioInbound: string | null;
  twilioStatus: string | null;
};

export function SmsSettingsSection(d: SmsSettingsProps) {
  const navigation = useNavigation();
  const [sp] = useSearchParams();
  const errorCode = sp.get("error");
  const smsSaved = sp.get("sms_saved") === "1";
  const testResult = sp.get("test_sms");

  const intentBusy = (intent: string) =>
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === intent;
  const testBusy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/test-message" &&
    navigation.formData?.get("intent") === "test_sms";

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-text">Text messaging</h2>
        {d.isOwner ? (
          <Form method="post" action="/api/org-settings">
            <input type="hidden" name="intent" value="save_channels" />
            <input type="hidden" name="returnTo" value="/settings" />
            <label className="sr-only" htmlFor="sms-enabled">SMS enabled</label>
            <select
              id="sms-enabled" name="sms_enabled" defaultValue={d.smsEnabled ? "true" : "false"}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              disabled={intentBusy("save_channels")}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </Form>
        ) : (
          <span className={`text-xs font-medium ${d.smsEnabled ? "text-cool" : "text-muted"}`}>
            {d.smsEnabled ? "On" : "Off"}
          </span>
        )}
      </div>

      {!d.smsEnabled && (
        <p className="mt-2 text-xs text-hot">Outbound texts are turned off — composers are disabled and sends are blocked.</p>
      )}

      {/* Sender override (owner only) */}
      {d.isOwner && (
        <Form method="post" action="/api/org-settings" className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="intent" value="save_sms_sender" />
          <input type="hidden" name="returnTo" value="/settings" />
          <h3 className="text-sm font-medium text-text">Sender configuration</h3>
          <div className="flex flex-col gap-1">
            <label htmlFor="sms-sender" className="text-xs font-medium text-muted">From number (E.164)</label>
            <input
              id="sms-sender"
              type="tel"
              name="sender"
              defaultValue={d.sender}
              placeholder="+15551234567"
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            {errorCode === "sms_sender" && (
              <p className="text-xs text-hot" role="alert">Enter a valid E.164 phone number (e.g. +15551234567)</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="sms-sid" className="text-xs font-medium text-muted">Messaging Service SID</label>
            <input
              id="sms-sid"
              name="messaging_service_sid"
              defaultValue={d.messagingServiceSid}
              placeholder="MG..."
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            {errorCode === "sms_sid" && (
              <p className="text-xs text-hot" role="alert">Enter a valid Messaging Service SID (MG + 32 hex characters)</p>
            )}
          </div>
          <p className="text-xs text-muted">
            Leave blank to use the NudgePay default sender. If both are set, the Messaging Service SID is used.
          </p>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={intentBusy("save_sms_sender")} className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed">
              {intentBusy("save_sms_sender") ? "Saving…" : "Save"}
            </button>
            {smsSaved && <span className="text-xs text-cool" role="status">Saved.</span>}
          </div>
        </Form>
      )}

      {/* Test SMS (owner only) */}
      {d.isOwner && (
        <Form method="post" action="/api/test-message" className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="intent" value="test_sms" />
          <input type="hidden" name="returnTo" value="/settings" />
          <h3 className="text-sm font-medium text-text">Send test SMS</h3>
          <div className="flex items-end gap-2">
            <label className="flex-1 grid gap-1 text-xs font-medium text-muted">
              Phone number
              <input
                type="tel" name="to" required placeholder="+15551234567"
                className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              />
            </label>
            <button type="submit" disabled={testBusy} className="h-8 shrink-0 rounded-md border border-border px-3 text-xs font-medium text-text hover:border-copper disabled:opacity-60 disabled:cursor-not-allowed">
              {testBusy ? "Sending…" : "Send test"}
            </button>
          </div>
          {testResult === "sent" && <p className="text-xs text-cool" role="status">Test SMS sent.</p>}
          {testResult === "invalid" && <p className="text-xs text-hot" role="alert">Enter a valid phone number.</p>}
          {testResult === "env" && <p className="text-xs text-hot" role="alert">Twilio isn't configured on the server yet — set the TWILIO_* secrets.</p>}
          {testResult === "error" && <p className="text-xs text-hot" role="alert">Test SMS failed — check the server logs.</p>}
        </Form>
      )}

      {/* Webhook URLs */}
      {(d.twilioInbound || d.twilioStatus) ? (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-text">Webhook URLs</h3>
          <p className="text-xs text-muted">Paste these into the Twilio console for your phone number or messaging service.</p>
          <WebhookUrlField label="Inbound messages" url={d.twilioInbound} />
          <WebhookUrlField label="Status callbacks" url={d.twilioStatus} />
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Set TWILIO_PUBLIC_BASE_URL to display webhook URLs.</p>
      )}

      {/* Provider status */}
      <div className="mt-4">
        <h3 className="text-sm font-medium text-text">Provider status</h3>
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted w-36">Server credentials</dt>
            <dd className={d.twilioConfigured ? "text-cool" : "text-hot"}>
              {d.twilioConfigured ? "Configured" : "Not configured"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted w-36">Last message sent</dt>
            <dd className="text-text" suppressHydrationWarning>
              {d.lastSentAt ?? "never"}
              {d.lastStatus && <span className="ml-1 text-muted">({d.lastStatus})</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted w-36">Delivery failures (7d)</dt>
            <dd className={d.failures7d > 0 ? "text-hot font-medium" : "text-text"}>
              {d.failures7d}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
