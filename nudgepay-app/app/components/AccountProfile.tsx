// app/components/AccountProfile.tsx
import { Form, Link, useNavigation } from "react-router";
import type { AccountStanding } from "../lib/accounts";
import type { TimelineEntry } from "../lib/timeline";
import { STANDING_LABEL, STANDING_CHIP } from "./AccountsDirectory";
import { formatUSD, STATUS_LABEL } from "../lib/format";
import { formatDate } from "../lib/dates";
import { CHANNELS } from "../lib/comm-prefs";
import { Icon } from "./Icons";

interface InvoiceLine {
  id: string;
  docNumber: string | null;
  amount: number;
  balance: number;
  dueDate: string | null;
  status: string | null;
}

interface Props {
  customerId: string;
  name: string;
  standing: AccountStanding;
  owner: string;
  ownerId: string | null;
  email: string | null;
  phone: string | null;
  smsConsent: boolean;
  commPrefs: { preferredChannel: string | null; doNotCall: boolean; doNotText: boolean };
  notes: string | null;
  openBalance: number;
  openInvoiceCount: number;
  oldestOverdueDays: number;
  lifetimeInvoiced: number;
  invoices: InvoiceLine[];
  timeline: TimelineEntry[];
  roster: { userId: string; label: string }[];
  activeCaseId: string | null;
  returnTo: string;
}

export function AccountProfile(p: Props) {
  const navigation = useNavigation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;

  return (
    <div key={p.customerId} className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <Link to="/accounts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <Icon name="chevronRight" size={14} className="rotate-180" /> Back to accounts
      </Link>

      {/* Header (ink) */}
      <header className="bg-ink text-surface rounded-card px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Account</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">{p.name}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[p.standing]}`}>
            {STANDING_LABEL[p.standing]}
          </span>
        </div>
        <p className="mt-1 text-sm text-surface/70">{p.owner} · {formatUSD(p.openBalance)} open</p>
        {p.activeCaseId ? (
          <Link
            to={`/dashboard?case=${p.activeCaseId}`}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded bg-copper text-surface text-xs font-medium"
          >
            Open in Collections <Icon name="external" size={14} />
          </Link>
        ) : null}
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open A/R", value: formatUSD(p.openBalance) },
          { label: "Open invoices", value: String(p.openInvoiceCount) },
          { label: "Oldest overdue", value: p.oldestOverdueDays > 0 ? `${p.oldestOverdueDays}d` : "—" },
          { label: "Lifetime invoiced (synced)", value: formatUSD(p.lifetimeInvoiced) },
        ].map((t) => (
          <div key={t.label} className="bg-paper border border-border rounded-tile p-4">
            <p className="font-mono text-[10px] uppercase text-muted">{t.label}</p>
            <p className="font-display text-xl text-text tabular-nums mt-1">{t.value}</p>
          </div>
        ))}
      </div>

      {/* Contact (read-only) */}
      <section className="bg-surface border border-border rounded-card p-5">
        <h2 className="font-display text-sm font-semibold text-text mb-1">Contact</h2>
        <p className="text-xs text-muted mb-3">From QuickBooks — read-only.</p>
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Phone</dt><dd className="text-text">{p.phone ?? "—"}</dd></div>
          <div><dt className="text-muted">Email</dt><dd className="text-text">{p.email ?? "—"}</dd></div>
          <div><dt className="text-muted">SMS consent</dt><dd className="text-text">{p.smsConsent ? "Yes" : "No"}</dd></div>
        </dl>
      </section>

      {/* Owner + comm prefs + notes (editable) */}
      <section className="bg-surface border border-border rounded-card p-5 space-y-5">
        <h2 className="font-display text-sm font-semibold text-text">Settings</h2>

        <Form method="post" action="/api/assign" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted">Owner
            <select
              name="ownerId"
              defaultValue={p.ownerId ?? ""}
              className="mt-1 block h-9 px-2 rounded border border-border bg-surface text-sm"
            >
              <option value="">Unassigned</option>
              {p.roster.map((m) => (
                <option key={m.userId} value={m.userId}>{m.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={formBusy("/api/assign")} className="h-9 px-3 rounded bg-ink text-surface text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">{formBusy("/api/assign") ? "Saving…" : "Save owner"}</button>
        </Form>

        <Form method="post" action="/api/comm-prefs" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted">Preferred channel
            <select
              name="preferred_channel"
              defaultValue={p.commPrefs.preferredChannel ?? "none"}
              className="mt-1 block h-9 px-2 rounded border border-border bg-surface text-sm"
            >
              <option value="none">No preference</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="do_not_call" value="true" defaultChecked={p.commPrefs.doNotCall} /> Do not call
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="do_not_text" value="true" defaultChecked={p.commPrefs.doNotText} /> Do not text
          </label>
          <button type="submit" disabled={formBusy("/api/comm-prefs")} className="h-9 px-3 rounded bg-ink text-surface text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">{formBusy("/api/comm-prefs") ? "Saving…" : "Save preferences"}</button>
        </Form>

        <Form method="post" action="/api/account-notes" className="space-y-2">
          <input type="hidden" name="returnTo" value={p.returnTo} />
          <input type="hidden" name="customerId" value={p.customerId} />
          <label className="text-sm text-muted block">Account notes
            <textarea
              name="notes"
              defaultValue={p.notes ?? ""}
              rows={4}
              className="mt-1 block w-full p-2 rounded border border-border bg-surface text-sm"
              placeholder="NudgePay-only notes (not synced to QuickBooks)…"
            />
          </label>
          <button type="submit" disabled={formBusy("/api/account-notes")} className="h-9 px-3 rounded bg-copper text-surface text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">{formBusy("/api/account-notes") ? "Saving…" : "Save notes"}</button>
        </Form>
      </section>

      {/* Invoices */}
      <section className="bg-surface border border-border rounded-card overflow-hidden">
        <h2 className="font-display text-sm font-semibold text-text px-5 py-3 bg-paper border-b border-border">Invoices</h2>
        {p.invoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No invoices.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="font-mono text-[10px] uppercase text-muted text-left">
                <th className="px-5 py-2">Doc #</th>
                <th className="px-5 py-2 text-right">Amount</th>
                <th className="px-5 py-2 text-right">Balance</th>
                <th className="px-5 py-2">Due</th>
                <th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-5 py-2 text-text">{inv.docNumber ?? "—"}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatUSD(inv.amount)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatUSD(inv.balance)}</td>
                  <td className="px-5 py-2 text-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</td>
                  <td className="px-5 py-2 text-muted">
                    {inv.status ? (STATUS_LABEL[inv.status] ?? inv.status) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Timeline (account-wide) */}
      <section className="bg-surface border border-border rounded-card p-5">
        <h2 className="font-display text-sm font-semibold text-text mb-3">Activity</h2>
        {p.timeline.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {p.timeline.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="mt-1 w-2 h-2 rounded-full bg-copper shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm text-text">
                    {e.kind === "log" ? (e.outcomeLabel ?? "Logged") : e.outcomeLabel}
                    <span className="text-muted"> · {formatDate(e.at)}</span>
                  </p>
                  {e.kind === "log" && e.notes ? <p className="text-sm text-muted">{e.notes}</p> : null}
                  {e.kind === "sms" && e.body ? <p className="text-sm text-muted">{e.body}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
