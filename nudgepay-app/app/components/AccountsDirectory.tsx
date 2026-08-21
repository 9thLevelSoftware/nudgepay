// app/components/AccountsDirectory.tsx
import { useEffect } from "react";
import { Form, Link, useNavigate } from "react-router";
import type { AccountRow, AccountStanding, AccountFilter, AccountSort } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { formatInstant } from "../lib/dates";
import {
  ACCOUNTS_DENSITY_IDS,
  DENSITY_STORAGE_KEY,
  accountsHref,
  parseDensity,
  type DensityId,
} from "../lib/queue-chrome";
import {
  PAYER_BAND_HINT,
  PAYER_BAND_LABEL,
  type PayerBand,
} from "../lib/payer-behavior";

export const STANDING_LABEL: Record<AccountStanding, string> = {
  current: "Current", overdue: "Overdue", in_collections: "In collections", on_hold: "On hold",
};
// Literal class strings for the Tailwind v4 scanner.
export const STANDING_CHIP: Record<AccountStanding, string> = {
  current: "bg-cool/10 text-cool",
  overdue: "bg-warm/10 text-warm",
  in_collections: "bg-copper/10 text-copper",
  on_hold: "bg-muted/10 text-muted",
};

const FILTER_TABS: { id: AccountFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open-balance", label: "Open balance" },
  { id: "paid-up", label: "Paid up" },
  { id: "unassigned", label: "Unassigned" },
  { id: "on-hold", label: "On hold" },
];
const SORTS: { id: AccountSort; label: string }[] = [
  { id: "name", label: "Name (A–Z)" },
  { id: "balance", label: "Open balance" },
  { id: "last-contact", label: "Last contact" },
];

const DENSITY_LABEL = { general: "General", risk: "Risk" } as const;

const PAYER_CHIP: Record<PayerBand, string> = {
  good: "bg-cool/10 text-cool",
  fair: "bg-warm/10 text-warm",
  risk: "bg-hot/10 text-hot",
  unknown: "bg-muted/10 text-muted",
};

const ACCOUNTS_GRID_GENERAL = "grid-cols-[2fr_1fr_1fr_1fr_1fr]";
const ACCOUNTS_GRID_RISK = "grid-cols-[2fr_1fr_1fr_1fr_minmax(72px,0.8fr)_minmax(64px,0.6fr)_minmax(56px,0.5fr)]";

function persistDensity(id: DensityId) {
  try { localStorage.setItem(DENSITY_STORAGE_KEY, id); } catch { /* private mode */ }
}

function formatDtp(days: number | null | undefined): string {
  return days == null || !Number.isFinite(days) ? "—" : `${Math.round(days)}d`;
}

function formatReplyPct(rate: number | null | undefined): string {
  return rate == null || !Number.isFinite(rate) ? "—" : `${Math.round(rate * 100)}%`;
}

interface Props {
  rows: AccountRow[];
  filter: AccountFilter;
  sort: AccountSort;
  search: string;
  density: DensityId;
  densityFromUrl: boolean;
  counts: Record<AccountFilter, number>;
  selectedId: string | null;
  timeZone?: string | null;
}

export function AccountsDirectory({
  rows, filter, sort, search, density, densityFromUrl, counts, selectedId, timeZone,
}: Props) {
  const navigate = useNavigate();
  const hrefDensity = densityFromUrl ? density : undefined;
  const risk = density === "risk";
  const grid = risk ? ACCOUNTS_GRID_RISK : ACCOUNTS_GRID_GENERAL;
  const chrome = { filter, sort, q: search || undefined, density: hrefDensity };

  useEffect(() => {
    if (densityFromUrl) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(DENSITY_STORAGE_KEY); } catch { return; }
    if (stored !== "general" && stored !== "detailed" && stored !== "risk") return;
    const next = parseDensity(stored);
    persistDensity(next);
    navigate(accountsHref({ ...chrome, density: next, customerId: selectedId }), { replace: true });
    // Hydrate once on mount so a later General click cannot bounce back to LS.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first landing only
  }, []);

  const link = (customerId: string) => accountsHref({ ...chrome, customerId });
  const tabHref = (id: AccountFilter) => accountsHref({ ...chrome, filter: id });

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      {/* Header band (paper) */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Accounts</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <div className="flex items-center rounded-md border border-border bg-panel p-0.5" aria-label="Account density">
          {ACCOUNTS_DENSITY_IDS.map((id) => {
            const pressed = id === "risk" ? density === "risk" : density !== "risk";
            return (
              <Link
                key={id}
                to={accountsHref({ filter, sort, q: search || undefined, density: id, customerId: selectedId })}
                aria-pressed={pressed}
                onClick={() => persistDensity(id)}
                className={[
                  "px-2.5 h-7 inline-flex items-center rounded text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                  pressed ? "bg-ink text-surface" : "text-muted hover:text-text",
                ].join(" ")}
              >
                {DENSITY_LABEL[id === "risk" ? "risk" : "general"]}
              </Link>
            );
          })}
        </div>
        <Form method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="sort" value={sort} />
          {hrefDensity ? <input type="hidden" name="density" value={hrefDensity} /> : null}
          <label className="sr-only" htmlFor="acct-search">Search accounts</label>
          <input
            id="acct-search" type="search" name="q" defaultValue={search} placeholder="Search name, phone, email…"
            className="h-8 w-48 px-2 rounded border border-border bg-surface text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <button type="submit" className="h-8 px-3 rounded bg-ink text-surface text-xs font-medium">Search</button>
        </Form>
        <Form method="get" className="flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          {search ? <input type="hidden" name="q" value={search} /> : null}
          {hrefDensity ? <input type="hidden" name="density" value={hrefDensity} /> : null}
          <label className="sr-only" htmlFor="acct-sort">Sort</label>
          <select
            id="acct-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      {/* Pill filter tabs with count badges */}
      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Account filters">
        {FILTER_TABS.map((t) => {
          const active = t.id === filter;
          return (
            <Link
              key={t.id} to={tabHref(t.id)} aria-current={active ? "page" : undefined}
              className={[
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border",
                active ? "bg-ink text-surface border-ink" : "bg-paper text-muted border-border hover:border-copper/50",
              ].join(" ")}
            >
              {t.label}
              <span className={active ? "text-surface/70" : "text-muted/70"}>{counts[t.id]}</span>
            </Link>
          );
        })}
      </nav>

      {/* Column header (paper, mono uppercase) */}
      <div className={`hidden md:grid ${grid} gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[11px] uppercase tracking-wide text-muted`}>
        {risk ? (
          <>
            <span>Customer</span><span>Standing</span><span>Open A/R</span><span>Oldest overdue</span>
            <span>Payer</span><span>Days-to-pay</span><span>Reply %</span>
          </>
        ) : (
          <>
            <span>Customer</span><span>Standing</span><span>Owner</span>
            <span className="text-right">Open balance</span><span>Last contact</span>
          </>
        )}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No accounts match this filter.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.customerId === selectedId;
            const band: PayerBand = r.payer?.band ?? "unknown";
            return (
              <li key={r.customerId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={link(r.customerId)}
                  className={[
                    "relative grid grid-cols-1 gap-1 md:gap-3 px-4 py-3 items-center hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                    risk
                      ? "md:grid-cols-[2fr_1fr_1fr_1fr_minmax(72px,0.8fr)_minmax(64px,0.6fr)_minmax(56px,0.5fr)]"
                      : "md:grid-cols-[2fr_1fr_1fr_1fr_1fr]",
                  ].join(" ")}
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.name}</span>
                  <span><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[r.standing]}`}>{STANDING_LABEL[r.standing]}</span></span>
                  {risk ? (
                    <>
                      <span className="text-sm text-text tabular-nums">{formatUSD(r.openBalance)}</span>
                      <span className="text-sm text-muted tabular-nums">{r.oldestOverdueDays > 0 ? `${r.oldestOverdueDays}d` : "—"}</span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold w-fit ${PAYER_CHIP[band]}`}
                        title={PAYER_BAND_HINT}
                      >
                        {PAYER_BAND_LABEL[band]}
                      </span>
                      <span className="text-sm text-muted tabular-nums">{formatDtp(r.payer?.daysToPay)}</span>
                      <span className="text-sm text-muted tabular-nums">{formatReplyPct(r.payer?.replyRate)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-muted truncate">{r.owner}</span>
                      <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.openBalance)}</span>
                      <span className="text-sm text-muted">{r.lastContact ? `${r.lastContact.channel} · ${formatInstant(r.lastContact.date, timeZone)}` : "—"}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
