import { Link, useNavigation } from "react-router";
import type { CommPrefs, Channel } from "~/lib/comm-prefs";
import { DrawerShell } from "./DrawerShell";

const CHANNEL_OPTIONS: { value: "" | Channel; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
];

export function CommPrefsDrawer({
  customerName, caseId, repInvoiceId, prefs, returnTo, closeHref, smsConsentSource,
}: {
  customerName: string;
  caseId: string;
  repInvoiceId: string | null;
  prefs: CommPrefs;
  returnTo: string;
  closeHref: string;
  smsConsentSource?: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null;
}) {
  const stopLocked = smsConsentSource === "inbound_stop";
  const navigation = useNavigation();
  const formBusy = navigation.state !== "idle" && navigation.formAction === "/api/comm-prefs";

  return (
    <DrawerShell label="Communication preferences" closeHref={closeHref}>
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-sm font-semibold text-text">Communication preferences</h2>
          <Link to={closeHref} className="inline-flex items-center min-h-6 text-xs text-muted hover:text-text rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">Close</Link>
        </div>
        <p className="text-xs text-muted">{customerName}</p>

        <form method="post" action="/api/comm-prefs" className="flex flex-col gap-4">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Preferred channel</span>
            <select name="preferred_channel" defaultValue={prefs.preferredChannel ?? ""}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
              {CHANNEL_OPTIONS.map((o) => <option key={o.value || "none"} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Do not contact on</legend>
            {/* Hidden *_set sentinels tell the parser this form owns the flag.
                Unchecked boxes submit nothing, so get("do_not_*") === "true" is false. */}
            <input type="hidden" name="do_not_call_set" value="1" />
            <input type="hidden" name="do_not_text_set" value="1" />
            <input type="hidden" name="do_not_email_set" value="1" />
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_call" value="true" defaultChecked={prefs.doNotCall} className="h-4 w-4 rounded border-border text-copper" />
              Do not call
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_text" value="true" defaultChecked={prefs.doNotText || stopLocked} disabled={stopLocked} className="h-4 w-4 rounded border-border text-copper" />
              Do not text <span className="text-[11px] text-muted">(blocks SMS sending)</span>
            </label>
            {stopLocked ? (
              <p className="text-xs text-hot">Stopped by inbound STOP. Owner override required.</p>
            ) : prefs.doNotText ? (
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" name="confirm_resubscribe_sms" value="true" className="h-4 w-4 rounded border-border text-copper" />
                Confirm re-enable texts (customer asked to receive texts again)
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_email" value="true" defaultChecked={prefs.doNotEmail} className="h-4 w-4 rounded border-border text-copper" />
              Do not email <span className="text-[11px] text-muted">(blocks email sending)</span>
            </label>
            {prefs.doNotEmail ? (
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" name="confirm_resubscribe" value="true" className="h-4 w-4 rounded border-border text-copper" />
                Confirm re-enable email (customer asked to receive mail again)
              </label>
            ) : null}
          </fieldset>

          <div className="flex justify-end gap-2">
            <Link to={closeHref} className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-text">Cancel</Link>
            <button type="submit" disabled={formBusy} className="rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed">
              {formBusy ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
    </DrawerShell>
  );
}
