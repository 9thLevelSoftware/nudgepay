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
  // Return path for form submissions (preserves active tab)
  returnTo?: string;
};

export function SmsSettingsSection(d: SmsSettingsProps) {
  const navigation = useNavigation();
  const [sp] = useSearchParams();
  const errorCode = sp.get("error");
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
            <input type="hidden" name="returnTo" value={d.returnTo ?? "/settings"} />
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

      {/* Sender identity (operator-managed) */}
      <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-panel/40 p-3">
        <h3 className="text-sm font-medium text-text">Sender configuration</h3>
        <p className="text-xs text-muted">
          SMS sender identity is operator-managed for tenant isolation. Outbound texts use the NudgePay default sender unless an approved sender inventory is configured by the service team.
        </p>
        {errorCode === "sms_sender_locked" && (
          <p className="text-xs text-hot" role="alert">Sender changes must be approved by NudgePay support.</p>
        )}
        <dl className="grid gap-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted w-36">Workspace sender</dt>
            <dd className="text-text tabular-nums">{d.sender || "Default sender"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted w-36">Messaging Service</dt>
            <dd className="text-text font-mono">{d.messagingServiceSid || "Default service"}</dd>
          </div>
        </dl>
      </div>

      {/* Test SMS (owner only) */}
      {d.isOwner && (
        <Form method="post" action="/api/test-message" className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="intent" value="test_sms" />
          <input type="hidden" name="returnTo" value={d.returnTo ?? "/settings"} />
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
