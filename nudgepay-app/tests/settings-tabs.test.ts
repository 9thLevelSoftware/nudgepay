import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  resolveSettingsTab,
  settingsReturnTo,
  shouldBlockTabChange,
  SETTINGS_UNSAVED_MESSAGE,
} from "../app/components/SettingsTabs";

const tabsSrc = readFileSync(new URL("../app/components/SettingsTabs.tsx", import.meta.url), "utf8");
const settingsSrc = readFileSync(new URL("../app/routes/settings.tsx", import.meta.url), "utf8");

describe("resolveSettingsTab", () => {
  it("returns 'workspace' for null", () => {
    expect(resolveSettingsTab(null)).toBe("workspace");
  });

  it("returns 'workspace' for empty string", () => {
    expect(resolveSettingsTab("")).toBe("workspace");
  });

  it("returns 'workspace' for unknown values", () => {
    expect(resolveSettingsTab("bogus")).toBe("workspace");
    expect(resolveSettingsTab("admin")).toBe("workspace");
  });

  it("returns valid tab ids unchanged", () => {
    expect(resolveSettingsTab("workspace")).toBe("workspace");
    expect(resolveSettingsTab("integrations")).toBe("integrations");
    expect(resolveSettingsTab("channels")).toBe("channels");
    expect(resolveSettingsTab("templates")).toBe("templates");
    expect(resolveSettingsTab("collections")).toBe("collections");
    expect(resolveSettingsTab("billing")).toBe("billing");
  });
});

describe("settingsReturnTo", () => {
  it("returns /settings for workspace tab", () => {
    expect(settingsReturnTo("workspace")).toBe("/settings");
  });

  it("returns tab-qualified path for other tabs", () => {
    expect(settingsReturnTo("integrations")).toBe("/settings?tab=integrations");
    expect(settingsReturnTo("channels")).toBe("/settings?tab=channels");
    expect(settingsReturnTo("templates")).toBe("/settings?tab=templates");
    expect(settingsReturnTo("collections")).toBe("/settings?tab=collections");
    expect(settingsReturnTo("billing")).toBe("/settings?tab=billing");
  });
});

describe("shouldBlockTabChange", () => {
  it("does not block when the form is clean", () => {
    expect(shouldBlockTabChange(false, false)).toBe(false);
    expect(shouldBlockTabChange(false, true)).toBe(false);
  });

  it("does not block clicking the current tab while dirty", () => {
    expect(shouldBlockTabChange(true, true)).toBe(false);
  });

  it("blocks switching to another tab when dirty", () => {
    expect(shouldBlockTabChange(true, false)).toBe(true);
  });
});

describe("NP-AUD-2026-116 dirty tab guard", () => {
  it("SettingsTabs consults dirty state and confirms before a tab Link navigates", () => {
    expect(tabsSrc).toContain("useSettingsDirty");
    expect(tabsSrc).toContain("shouldBlockTabChange(dirty, isCurrent)");
    // Styled async confirm replaced native window.confirm.
    expect(tabsSrc).toContain("useConfirm");
    expect(tabsSrc).toContain("SETTINGS_UNSAVED_MESSAGE");
    expect(tabsSrc).not.toContain("window.confirm");
    expect(tabsSrc).toContain('aria-current={isCurrent ? "page" : undefined}');
    expect(SETTINGS_UNSAVED_MESSAGE.toLowerCase()).toMatch(/unsaved/);
  });

  it("settings page registers dirty from form changes for every role", () => {
    expect(settingsSrc).toContain("SettingsDirtyProvider");
    expect(settingsSrc).toContain("resetKey=");
    const providerIdx = settingsSrc.indexOf("<SettingsDirtyProvider");
    const tabsIdx = settingsSrc.indexOf("<SettingsTabs");
    expect(providerIdx).toBeGreaterThan(-1);
    expect(tabsIdx).toBeGreaterThan(providerIdx);
    expect(settingsSrc.slice(providerIdx, tabsIdx)).not.toMatch(/isOwner/);
    expect(tabsSrc).toMatch(/onInput=\{markDirty\}/);
    expect(tabsSrc).toMatch(/onChange=\{markDirty\}/);
    expect(tabsSrc).not.toContain("unstable_usePrompt");
    expect(tabsSrc).not.toContain("useBlocker");
    expect(settingsSrc).not.toContain("useBlocker");
  });
});
