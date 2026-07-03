// SettingsTabs — horizontal tab bar for the settings page.
// Tabs are search-param driven (?tab=...) to avoid loader/action churn.

import { Link, useSearchParams } from "react-router";

export const SETTINGS_TABS = [
  { id: "workspace",    label: "Workspace" },
  { id: "integrations", label: "Integrations" },
  { id: "channels",     label: "Channels" },
  { id: "templates",    label: "Templates" },
  { id: "collections",  label: "Collections" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

const VALID_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

/** Resolve a raw search-param value to a valid tab id, defaulting to "workspace". */
export function resolveSettingsTab(param: string | null): SettingsTabId {
  if (param && VALID_IDS.has(param)) return param as SettingsTabId;
  return "workspace";
}

/** Build a returnTo path that preserves the current tab. */
export function settingsReturnTo(tab: SettingsTabId): string {
  return tab === "workspace" ? "/settings" : `/settings?tab=${tab}`;
}

export function SettingsTabs() {
  const [sp] = useSearchParams();
  const active = resolveSettingsTab(sp.get("tab"));

  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Settings sections">
      {SETTINGS_TABS.map((t) => {
        const isCurrent = t.id === active;
        return (
          <Link
            key={t.id}
            to={t.id === "workspace" ? "/settings" : `?tab=${t.id}`}
            aria-current={isCurrent ? "page" : undefined}
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
