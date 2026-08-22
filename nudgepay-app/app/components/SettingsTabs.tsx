// SettingsTabs — horizontal tab bar for the settings page.
// Tabs are search-param driven (?tab=...) to avoid loader/action churn.
// Dirty tab Links confirm before navigating so unsaved edits are not discarded.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ConfirmProvider, useConfirm } from "./Confirm";

export const SETTINGS_TABS = [
  { id: "workspace",    label: "Workspace" },
  { id: "integrations", label: "Integrations" },
  { id: "channels",     label: "Channels" },
  { id: "templates",    label: "Templates" },
  { id: "collections",  label: "Collections" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

const VALID_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

export const SETTINGS_UNSAVED_MESSAGE =
  "You have unsaved changes. Leave this tab and discard them?";

/** Resolve a raw search-param value to a valid tab id, defaulting to "workspace". */
export function resolveSettingsTab(param: string | null): SettingsTabId {
  if (param && VALID_IDS.has(param)) return param as SettingsTabId;
  return "workspace";
}

/** Build a returnTo path that preserves the current tab. */
export function settingsReturnTo(tab: SettingsTabId): string {
  return tab === "workspace" ? "/settings" : `/settings?tab=${tab}`;
}

/** True when a tab Link should confirm before navigating away from unsaved edits. */
export function shouldBlockTabChange(dirty: boolean, targetIsCurrent: boolean): boolean {
  return dirty && !targetIsCurrent;
}

type SettingsDirtyValue = {
  dirty: boolean;
  markDirty: () => void;
};

const SettingsDirtyContext = createContext<SettingsDirtyValue>({
  dirty: false,
  markDirty: () => {},
});

export function useSettingsDirty(): SettingsDirtyValue {
  return useContext(SettingsDirtyContext);
}

/**
 * Page-level dirty registry. Descendant form controls mark dirty on input/change
 * (event bubbling — no per-form rewrite). `resetKey` clears after tab change or
 * a successful save flash so a persisted edit does not keep blocking.
 */
export function SettingsDirtyProvider({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey: string;
}) {
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    setDirty(false);
  }, [resetKey]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const value = useMemo(() => ({ dirty, markDirty }), [dirty, markDirty]);

  return (
    <SettingsDirtyContext.Provider value={value}>
      <div className="contents" onInput={markDirty} onChange={markDirty}>
        {children}
      </div>
    </SettingsDirtyContext.Provider>
  );
}

export function SettingsTabs() {
  return (
    <ConfirmProvider>
      <SettingsTabsNav />
    </ConfirmProvider>
  );
}

function SettingsTabsNav() {
  const [sp] = useSearchParams();
  const active = resolveSettingsTab(sp.get("tab"));
  const { dirty } = useSettingsDirty();
  const confirm = useConfirm();
  const navigate = useNavigate();

  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Settings sections">
      {SETTINGS_TABS.map((t) => {
        const isCurrent = t.id === active;
        const to = t.id === "workspace" ? "/settings" : `?tab=${t.id}`;
        return (
          <Link
            key={t.id}
            to={to}
            aria-current={isCurrent ? "page" : undefined}
            onClick={async (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              if (isCurrent) {
                event.preventDefault();
                return;
              }
              if (shouldBlockTabChange(dirty, isCurrent)) {
                event.preventDefault();
                const ok = await confirm({
                  title: "Unsaved changes",
                  message: SETTINGS_UNSAVED_MESSAGE,
                  confirmLabel: "Discard changes",
                  cancelLabel: "Stay",
                  tone: "destructive",
                });
                if (!ok) return;
                navigate(to);
              }
            }}
            className={[
              "px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-offset-2",
              isCurrent
                ? "border-copper text-copper"
                : "border-transparent text-muted hover:text-text hover:border-border",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
