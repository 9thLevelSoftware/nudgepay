import { describe, it, expect } from "vitest";
import { resolveSettingsTab, settingsReturnTo } from "../app/components/SettingsTabs";

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
  });
});
