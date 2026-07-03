import { Form, useNavigation, useSearchParams } from "react-router";
import { WebhookUrlField } from "./WebhookUrlField";

export type EmailSettingsProps = {
  isOwner: boolean;
  emailEnabled: boolean;
  fromAddress: string;
  fromName: string;
  postalAddress: string;
  ownerEmail: string;
  // Provider status
  resendConfigured: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
  failures7d: number;
  // Webhook URL
  resendWebhook: string | null;
};

export function EmailSettingsSection(d: EmailSettingsProps) {
  const navigation = useNavigation();
  const [sp] = useSearchParams();
  const saved = sp.get("email_saved") === "1";
  const errorCode = sp.get("error");
  const testResult = sp.get("test_email");

  const intentBusy = (intent: string) =>
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === intent;
  const testBusy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/test-message" &&
    navigation.formData?.get("intent") === "test_email";

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-text">Email</h2>
        <span className={`text-xs font-medium ${d.emailEnabled ? "text-cool" : "text-muted"}`}>
          {d.emailEnabled ? "On" : "Off"}
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
              defaultChecked={d.emailEnabled}
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
              defaultValue={d.fromAddress}
              placeholder="billing@yourdomain.com"
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            <p className="text-xs text-muted">Must be on a domain you've verified with Resend (SPF/DKIM)</p>
            {errorCode === "email" && (
              <p className="text-xs text-hot" role="alert">Enter a valid from address</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="from-name" className="text-xs font-medium text-muted">From name</label>
            <input
              id="from-name"
              name="from_name"
              defaultValue={d.fromName}
              placeholder="Your business name"
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="postal-address" className="text-xs font-medium text-muted">Business mailing address</label>
            <textarea
              id="postal-address"
              name="postal_address"
              defaultValue={d.postalAddress}
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
            {saved && <span className="text-xs text-cool" role="status">Saved.</span>}
          </div>
        </Form>
      ) : (
        <dl className="mt-2 flex flex-col gap-1 text-sm">
          <div className="flex gap-2"><dt className="text-muted w-28">Status</dt><dd className={d.emailEnabled ? "text-cool" : "text-muted"}>{d.emailEnabled ? "On" : "Off"}</dd></div>
          <div className="flex gap-2"><dt className="text-muted w-28">From</dt><dd className="text-text">{d.fromAddress || "Not configured"}</dd></div>
        </dl>
      )}

      {/* Test email (owner only) */}
      {d.isOwner && (
        <Form method="post" action="/api/test-message" className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="intent" value="test_email" />
          <input type="hidden" name="returnTo" value="/settings" />
          <h3 className="text-sm font-medium text-text">Send test email</h3>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted">Sends to <span className="font-medium text-text">{d.ownerEmail || "your account email"}</span></p>
            <button type="submit" disabled={testBusy} className="shrink-0 rounded-md border border-border px-3 py-1 text-xs font-medium text-text hover:border-copper disabled:opacity-60 disabled:cursor-not-allowed">
              {testBusy ? "Sending…" : "Send test"}
            </button>
          </div>
          {testResult === "sent" && <p className="text-xs text-cool" role="status">Test email sent.</p>}
          {testResult === "env" && <p className="text-xs text-hot" role="alert">Resend isn't configured on the server yet — set the RESEND_* secrets.</p>}
          {testResult === "nofrom" && <p className="text-xs text-hot" role="alert">Configure a from address above before testing.</p>}
          {testResult === "error" && <p className="text-xs text-hot" role="alert">Test email failed — check the server logs.</p>}
        </Form>
      )}

      {/* Webhook URL */}
      {d.resendWebhook ? (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-text">Webhook URL</h3>
          <p className="text-xs text-muted">Paste this into the Resend dashboard for delivery event webhooks.</p>
          <WebhookUrlField label="Delivery events" url={d.resendWebhook} />
        </div>
      ) : null}

      {/* Provider status */}
      <div className="mt-4">
        <h3 className="text-sm font-medium text-text">Provider status</h3>
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted w-36">Server credentials</dt>
            <dd className={d.resendConfigured ? "text-cool" : "text-hot"}>
              {d.resendConfigured ? "Configured" : "Not configured"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted w-36">Last email sent</dt>
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
