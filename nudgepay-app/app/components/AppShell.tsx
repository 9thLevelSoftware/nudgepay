import { useEffect, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigation } from "react-router";
import { Icon } from "./Icons";
import { ToastProvider } from "./Toasts";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";
import { ICON_HIT_CLASS, MAIN_CONTENT_ID, SkipLink } from "./ui";
import { SUPPORT_MAILTO } from "../lib/meta";

interface AppShellProps {
  orgName: string;
  orgId?: string;
  workspaces?: { orgId: string; name: string }[];
  userInitials: string;
  /** Display name already resolved by the loader; initials are used if omitted. */
  userLabel?: string;
  syncLabel: string;
  connected: boolean;
  /** True workspace owner (delete workspace, grant owner). */
  isOwner: boolean;
  /** Owner or admin — settings, reports, STOP override. Defaults to isOwner. */
  isAdmin?: boolean;
  /** Which primary section is active (drives the nav rail + topbar title). */
  activeNav?: "collections" | "accounts" | "promises" | "messages" | "reports" | "settings";
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

/** Prefetch the destination loader on hover/focus so click-to-page does not wait cold. */
const NAV_PREFETCH = "intent" as const;

const NAV_ITEMS: NavItem[] = [
  { name: "collections", icon: "bookmark", label: "Collections" },
  { name: "accounts", icon: "user", label: "Accounts" },
  { name: "promises", icon: "check", label: "Promises" },
  { name: "messages", icon: "message", label: "Messages" },
  { name: "reports", icon: "note", label: "Reports" },
];

/** Accessible name for Reports in the side nav. Members hear admin-gating, not "coming soon". */
export function reportsNavLabel(canViewReports: boolean): string {
  return canViewReports ? "Reports" : "Reports (Admin only)";
}

/**
 * AppShell — the application frame for the NudgePay collections workspace.
 *
 * Layout:
 *   - `ink` top bar: brand mark, workspace title "Collections", sync chip,
 *     settings icon, user avatar that opens an account menu.
 *   - `ink` left icon side-nav: Collections / Accounts / Promises / Messages
 *     (live links, copper left-edge indicator on the active section);
 *     Reports (link, owners only). Settings is reached from the top bar
 *     (gear icon + sync chip + account menu), not the side-nav.
 *   - Main area: `bg-panel`, renders `children`.
 *
 * Responsive: side-nav hidden below `md`, toggled via the menu button in the
 * top bar. A backdrop overlay closes the drawer on mobile.
 *
 * Accessibility: copper focus rings on all interactive elements,
 * aria-disabled on restricted nav items (Reports for members, labeled
 * "Admin only"), aria-label on icon-only controls, aria-expanded on the
 * menu toggle and account menu.
 */
export function AppShell({
  orgName,
  orgId,
  workspaces = [],
  userInitials,
  userLabel,
  syncLabel,
  connected,
  isOwner,
  isAdmin,
  activeNav = "collections",
  headerActions,
  syncIssues,
  children,
}: AppShellProps) {
  const canViewReports = isAdmin ?? isOwner;
  const [navOpen, setNavOpen] = useState(false);
  const busy = useNavigation().state !== "idle";

  const SECTION_TITLES: Record<string, string> = {
    collections: "Collections", accounts: "Accounts", promises: "Promises", messages: "Messages", reports: "Reports", settings: "Settings",
  };
  const sectionTitle = SECTION_TITLES[activeNav] ?? "Collections";
  const NAV_TARGETS: Record<string, string> = {
    collections: "/dashboard", accounts: "/accounts", promises: "/promises", messages: "/messages",
  };

  return (
    <ToastProvider>
    <div className="relative flex flex-col h-screen overflow-hidden font-sans">
      <SkipLink />
      {busy && (
        <div
          role="progressbar"
          aria-label="Loading"
          className="absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden opacity-0 motion-reduce:opacity-100 animate-[fade-in_200ms_ease-in_150ms_forwards]"
        >
          <div className="h-full w-1/3 bg-copper animate-[progress-slide_1s_ease-in-out_infinite] motion-reduce:w-full" />
        </div>
      )}
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 h-12 shrink-0 bg-ink text-surface">
        {/* Mobile menu toggle */}
        <button
          type="button"
          className={`md:hidden ${ICON_HIT_CLASS} rounded text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper`}
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <Icon name="menu" size={18} />
        </button>

        {/* Brand mark */}
        <Link
          to="/dashboard"
          prefetch={NAV_PREFETCH}
          className="flex items-center gap-0 font-display text-[17px] font-semibold leading-none tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          <span className="text-copper-bright">Nudge</span>
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
            prefetch={NAV_PREFETCH}
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
            prefetch={NAV_PREFETCH}
            className={`${ICON_HIT_CLASS} rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper`}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={16} />
          </Link>

          <UserMenu userInitials={userInitials} userLabel={userLabel} orgId={orgId} workspaces={workspaces} />
        </div>
      </header>

      {/* ── Body (side-nav + main) ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop */}
        {navOpen && (
          <div
            className="fixed inset-0 z-20 bg-ink/40 md:hidden"
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
              const isReportsForAdmin = item.name === "reports" && canViewReports;
              // Reports is admin-only and absent from NAV_TARGETS; give it a
              // target for admins so it can show the copper active state, while
              // members still fall through to the disabled item below.
              const target = NAV_TARGETS[item.name] ?? (isReportsForAdmin ? "/reports" : undefined);
              const ariaLabel = item.name === "reports" ? reportsNavLabel(canViewReports) : item.label;

              if (isActive && target) {
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={target}
                      prefetch={NAV_PREFETCH}
                      className="relative flex flex-col items-center justify-center w-full py-3 gap-1 text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-current="page"
                      aria-label={ariaLabel}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="absolute left-0 inset-y-0 w-0.5 bg-copper rounded-r" aria-hidden="true" />
                      <Icon name={item.icon} size={18} className="text-copper-bright" />
                      <span className="text-[10px] font-sans font-medium uppercase tracking-wide text-copper-bright leading-none">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              }

              if (target || isReportsForAdmin) {
                const to = target ?? "/reports";
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to={to}
                      prefetch={NAV_PREFETCH}
                      className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-label={ariaLabel}
                      onClick={() => setNavOpen(false)}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="text-[10px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
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
                    aria-label={ariaLabel}
                    title="Admin only"
                    tabIndex={-1}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="text-[10px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                  </a>
                </li>
              );
            })}
            {/* Mobile-only Focus. Not a sixth activeNav — header chip stays on dashboard. */}
            <li className="relative w-full md:hidden">
              <Link
                to="/focus"
                prefetch={NAV_PREFETCH}
                className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                aria-label="Focus mode"
                onClick={() => setNavOpen(false)}
              >
                <Icon name="circle" size={18} />
                <span className="text-[10px] font-sans font-medium uppercase tracking-wide leading-none">Focus</span>
              </Link>
            </li>
          </ul>
        </nav>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main
          className="flex-1 overflow-auto bg-panel"
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
    <CommandPalette />
    </ToastProvider>
  );
}

const menuItemClass =
  "block w-full px-3 py-2 text-left text-[13px] font-sans text-surface/80 hover:bg-surface/5 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset";

function UserMenu({
  userInitials,
  userLabel,
  orgId,
  workspaces,
}: {
  userInitials: string;
  userLabel?: string;
  orgId?: string;
  workspaces: { orgId: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const displayName = userLabel?.trim() || userInitials;
  const location = useLocation();
  const returnTo = location.pathname + location.search;

  useEffect(() => {
    if (!open) {
      setConfirmSignOut(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (confirmSignOut) confirmRef.current?.focus();
  }, [confirmSignOut]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${ICON_HIT_CLASS} rounded-full bg-copper/20 border border-copper/40 text-copper-bright font-sans text-[11px] font-semibold uppercase leading-none select-none hover:bg-copper/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account menu (${displayName})`}
        title="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        {userInitials}
      </button>

      {open ? (
        <div
          id="account-menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-md border border-surface/10 bg-ink py-1 shadow-panel"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface/10" role="presentation">
            <span
              className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-copper/20 border border-copper/40 text-copper-bright font-sans text-[11px] font-semibold uppercase leading-none"
              aria-hidden="true"
            >
              {userInitials}
            </span>
            <span className="min-w-0 truncate text-[13px] font-sans font-medium text-surface">{displayName}</span>
          </div>
          {workspaces.length > 0 ? (
            <div className="border-b border-surface/10 py-1">
              <p className="px-3 py-1 text-[10px] font-sans uppercase tracking-wide text-surface/40">Workspaces</p>
              {workspaces.map((w) => {
                const current = orgId ? w.orgId === orgId : false;
                return (
                  <Form key={w.orgId} method="post" action="/api/workspace/switch">
                    <input type="hidden" name="orgId" value={w.orgId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button
                      type="submit"
                      className={menuItemClass}
                      aria-current={current ? "true" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {w.name}{current ? " (current)" : ""}
                    </button>
                  </Form>
                );
              })}
              <Link
                to="/onboarding?new=1"
                className={menuItemClass}
                onClick={() => setOpen(false)}
              >
                Create workspace
              </Link>
            </div>
          ) : null}
           <Link
             to="/settings"
             prefetch={NAV_PREFETCH}
             className={menuItemClass}
             onClick={() => setOpen(false)}
           >
             Settings
           </Link>
           <a
             href={SUPPORT_MAILTO}
             className={menuItemClass}
             onClick={() => setOpen(false)}
           >
             Support
           </a>
           <ThemeToggle />
           {confirmSignOut ? (
            <Form method="post" action="/logout">
              <button ref={confirmRef} type="submit" className={`${menuItemClass} text-hot hover:text-hot`}>
                Confirm sign out
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
            </Form>
          ) : (
            <button
              type="button"
              className={menuItemClass}
              onClick={() => setConfirmSignOut(true)}
            >
              Sign out
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
