import { Link, useNavigate, useNavigation } from "react-router";
import type { CommPrefs, Channel } from "~/lib/comm-prefs";
import { useDialog } from "~/lib/use-dialog";

const CHANNEL_OPTIONS: { value: "" | Channel; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
];

export function CommPrefsDrawer({
  customerName, caseId, repInvoiceId, prefs, returnTo, closeHref,
}: {
  customerName: string;
  caseId: string;
  repInvoiceId: string | null;
  prefs: CommPrefs;
  returnTo: string;
  closeHref: string;
}) {
  const navigate = useNavigate();
  const { panelRef } = useDialog({ onClose: () => navigate(closeHref) });
  const navigation = useNavigation();
  const formBusy = navigation.state !== "idle" && navigation.formAction === "/api/comm-prefs";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Communication preferences">
      {/* Overlay click closes (Link to the case without ?prefs) */}
      <Link to={closeHref} aria-hidden="true" tabIndex={-1} aria-label="Close" className="absolute inset-0" />
      <div ref={panelRef} className="relative z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-5 shadow-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-sm font-semibold text-text">Communication preferences</h2>
          <Link to={closeHref} className="text-xs text-muted hover:text-text">Close</Link>
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
            {/* Checkbox only (value "true"): an unchecked box submits nothing, so the action's
                `form.get("do_not_*") === "true"` correctly resolves to false. Do NOT add a hidden
                "false" sibling — same-named fields make get() ambiguous (returns the first value). */}
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_call" value="true" defaultChecked={prefs.doNotCall} className="h-4 w-4 rounded border-border text-copper" />
              Do not call
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_text" value="true" defaultChecked={prefs.doNotText} className="h-4 w-4 rounded border-border text-copper" />
              Do not text <span className="text-[10px] text-muted">(blocks SMS sending)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_email" value="true" defaultChecked={prefs.doNotEmail} className="h-4 w-4 rounded border-border text-copper" />
              Do not email <span className="text-[10px] text-muted">(blocks email sending)</span>
            </label>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Link to={closeHref} className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-text">Cancel</Link>
            <button type="submit" disabled={formBusy} className="rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-surface hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed">
              {formBusy ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
