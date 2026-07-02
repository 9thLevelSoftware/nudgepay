import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { Icon } from "./Icons";

interface AppShellProps {
  orgName: string;
  userInitials: string;
  syncLabel: string;
  connected: boolean;
  /** Reserved for future owner-gated header actions (Task 6+). */
  isOwner: boolean;
  /** Which primary section is active (drives the nav rail + topbar title). */
  activeNav?: "collections" | "accounts" | "promises" | "messages" | "reports";
  /** Optional controls rendered in the topbar right-controls group. */
  headerActions?: React.ReactNode;
  /** Optional sync-issues indicator rendered next to the sync chip. */
  syncIssues?: React.ReactNode;
  children: React.ReactNode;
}

interface NavItem {
  name: string;
  icon: "bookmark" | "user" | "check" | "message" | "note" | "settings";
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: "collections", icon: "bookmark", label: "Collections" },
  { name: "accounts", icon: "user", label: "Accounts" },
  { name: "promises", icon: "check", label: "Promises" },
  { name: "messages", icon: "message", label: "Messages" },
  { name: "reports", icon: "note", label: "Reports" },
];

/**
 * AppShell — the application frame for the NudgePay collections workspace.
 *
 * Layout:
 *   - `ink` top bar: brand mark, workspace title "Collections", sync chip,
 *     settings icon, user avatar with initials.
 *   - `ink` left icon side-nav: Collections / Accounts / Promises / Messages
 *     (live links, copper left-edge indicator on the active section);
 *     Reports (link, owners only). Settings is reached from the top bar
 *     (gear icon + sync chip), not the side-nav.
 *   - Main area: `bg-panel`, renders `children`.
 *
 * Responsive: side-nav hidden below `md`, toggled via the menu button in the
 * top bar. A backdrop overlay closes the drawer on mobile.
 *
 * Accessibility: copper focus rings on all interactive elements,
 * aria-disabled on restricted nav items (Reports for non-owners), aria-label on icon-only controls,
 * aria-expanded on the menu toggle.
 */
export function AppShell({
  orgName,
  userInitials,
  syncLabel,
  connected,
  isOwner,
  activeNav = "collections",
  headerActions,
  syncIssues,
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const busy = useNavigation().state !== "idle";

  const SECTION_TITLES: Record<string, string> = {
    collections: "Collections", accounts: "Accounts", promises: "Promises", messages: "Messages", reports: "Reports",
  };
  const sectionTitle = SECTION_TITLES[activeNav] ?? "Collections";
  const NAV_TARGETS: Record<string, string> = {
    collections: "/dashboard", accounts: "/accounts", promises: "/promises", messages: "/messages",
  };

  return (
    <div className="relative flex flex-col h-screen overflow-hidden font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 rounded-md bg-copper px-3 py-2 text-sm font-semibold text-ink"
      >
        Skip to content
      </a>
      {busy && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden animate-[fade-in_150ms_ease-in]">
          <div className="h-full w-1/3 bg-copper animate-[progress-slide_1s_ease-in-out_infinite]" />
        </div>
      )}
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 h-12 shrink-0 bg-ink text-surface">
        {/* Mobile menu toggle */}
        <button
          type="button"
          className="md:hidden flex items-center justify-center w-8 h-8 rounded text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <Icon name="menu" size={18} />
        </button>

        {/* Brand mark */}
        <Link
          to="/dashboard"
          className="flex items-center gap-0 font-display text-[17px] font-semibold leading-none tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          <span className="text-copper">Nudge</span>
          <span className="text-surface/90">Pay</span>
        </Link>

        {/* Workspace title */}
        <span
          className="hidden sm:flex items-center gap-1.5 text-surface/40 text-[13px] font-sans"
          aria-hidden="true"
        >
          <span>/</span>
          <span className="text-surface/70 font-medium">{orgName}</span>
          <span>/</span>
          <span className="text-surface/90 font-medium">{sectionTitle}</span>
        </span>

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-2">
          {/* Sync chip → Settings */}
          <Link
            to="/settings"
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-surface/5 border border-surface/10 hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label={connected ? `Connected — ${syncLabel}` : `Disconnected — ${syncLabel}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-copper" : "bg-muted"}`}
              aria-hidden="true"
            />
            <span className="text-[11px] font-sans text-surface/60 leading-none">
              {syncLabel}
            </span>
          </Link>

          {syncIssues}

          {headerActions}

          {/* Settings */}
          <Link
            to="/settings"
            className="flex items-center justify-center w-8 h-8 rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={16} />
          </Link>

          {/* User avatar → sign out (POST so the action runs) */}
          <Form method="post" action="/logout" className="contents">
            <button
              type="submit"
              className="flex items-center justify-center w-7 h-7 rounded-full bg-copper/20 border border-copper/40 text-copper font-sans text-[11px] font-semibold uppercase leading-none select-none hover:bg-copper/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              aria-label={`Sign out (${userInitials})`}
              title="Sign out"
            >
              {userInitials}
            </button>
          </Form>
        </div>
      </header>

      {/* ── Body (side-nav + main) ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop */}
        {navOpen && (
          <div
            className="fixed inset-0 z-20 bg-ink/60 md:hidden"
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* ── Side nav ──────────────────────────────────────────────────── */}
        <nav
          className={[
            // Base: fixed on mobile (slide in/out), static on md+
            "fixed md:static inset-y-0 left-0 z-30 flex flex-col",
            "w-[88px] bg-ink text-surface/60",
            "transition-transform duration-200 ease-in-out",
            // On mobile: shift nav below the 48px top bar
            "top-12 md:top-0",
            // Mobile: translate off-screen when closed
            navOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          ].join(" ")}
          aria-label="Main navigation"
        >
          <ul className="flex flex-col items-center gap-1 pt-3" role="list">
            {NAV_ITEMS.map((item) => {
              const isActive = item.name === activeNav;
              const isReportsForOwner = item.name === "reports" && isOwner;
              // Reports is owner-only and absent from NAV_TARGETS; give it a
              // target for owners so it can show the copper active state, while
              // non-owners still fall through to the disabled item below.
              const target = NAV_TARGETS[item.name] ?? (isReportsForOwner ? "/reports" : undefined);

              if (isActive && target) {
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={target}
                      className="relative flex flex-col items-center justify-center w-full py-3 gap-1 text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-current="page"
                      aria-label={item.label}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="absolute left-0 inset-y-0 w-0.5 bg-copper rounded-r" aria-hidden="true" />
                      <Icon name={item.icon} size={18} className="text-copper" />
                      <span className="text-[9px] font-sans font-medium uppercase tracking-wide text-copper leading-none">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              }

              if (target || isReportsForOwner) {
                const to = target ?? "/reports";
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={to}
                      className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-label={item.label}
                      onClick={() => setNavOpen(false)}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="text-[9px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                    </Link>
                  </li>
                );
              }

              return (
                <li key={item.name} className="relative w-full">
                  {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                  <a
                    href="#"
                    className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/40 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                    aria-disabled="true"
                    aria-label={`${item.label} (coming soon)`}
                    tabIndex={-1}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="text-[9px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main
          className="flex-1 overflow-auto bg-panel"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
