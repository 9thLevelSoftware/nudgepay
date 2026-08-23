import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionSrc = readFileSync(new URL("../app/routes/api.org-settings.tsx", import.meta.url), "utf8");

function readComponent(name: string): string {
  return readFileSync(new URL(`../app/components/${name}`, import.meta.url), "utf8");
}

function successFlashByIntent(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const matches = [...src.matchAll(/if \(intent === "([^"]+)"\) \{/g)];
  for (let i = 0; i < matches.length; i++) {
    const intent = matches[i][1];
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : src.length;
    const body = src.slice(start, end);
    const flags = [...body.matchAll(/return redirect\(flag\(returnTo, "([^"]+)", "([^"]+)"\)/g)];
    const success = flags.filter((f) => f[1] !== "error");
    if (success.length) {
      const last = success[success.length - 1];
      map.set(intent, `${last[1]}=${last[2]}`);
    }
  }
  return map;
}

function savedEquals(src: string): string[] {
  const fromGet = [...src.matchAll(/sp\.get\("saved"\) === "([^"]+)"/g)].map((m) => m[1]);
  const fromVar = [...src.matchAll(/\bsaved === "([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...fromGet, ...fromVar])];
}

const INTENT_FLASH: Record<string, string> = {
  save_company_profile: "saved=profile",
  save_channels: "saved=channels",
  save_quiet_hours: "saved=quiet_hours",
  save_rules: "saved=rules",
  add_holiday: "saved=holiday",
  remove_holiday: "saved=holiday",
  save_late_fees: "saved=late_fees",
  save_priority_thresholds: "saved=priority",
  save_workflow: "saved=workflow",
  save_email: "email_saved=1",
  save_template: "saved=template",
  delete_template: "saved=template",
  reset_templates: "saved=template",
};

const FORM_SAVED: Array<{ file: string; keys: string[] }> = [
  { file: "LateFeesForm.tsx", keys: ["late_fees"] },
  { file: "PriorityThresholdsForm.tsx", keys: ["priority"] },
  { file: "WorkflowSettingsForm.tsx", keys: ["workflow"] },
  { file: "CollectionsRulesForm.tsx", keys: ["rules", "holiday"] },
  { file: "SmsSettingsSection.tsx", keys: ["channels"] },
  { file: "QuietHoursForm.tsx", keys: ["quiet_hours"] },
  { file: "CompanyProfileForm.tsx", keys: ["profile"] },
  { file: "TemplateEditor.tsx", keys: ["template"] },
];

describe("org-settings intent flash keys (NP-AUD-2026-115)", () => {
  const flashes = successFlashByIntent(actionSrc);

  it("maps each success intent to a distinct flash key", () => {
    expect([...flashes.keys()].sort()).toEqual(Object.keys(INTENT_FLASH).sort());
    for (const [intent, flash] of Object.entries(INTENT_FLASH)) {
      expect(flashes.get(intent), intent).toBe(flash);
    }
  });

  it("does not redirect any intent with the shared saved=1 token", () => {
    expect(actionSrc).not.toContain('flag(returnTo, "saved", "1")');
    expect([...flashes.values()]).not.toContain("saved=1");
  });

  it("preserves existing distinct keys", () => {
    expect(flashes.get("save_company_profile")).toBe("saved=profile");
    expect(flashes.get("save_quiet_hours")).toBe("saved=quiet_hours");
    expect(flashes.get("save_email")).toBe("email_saved=1");
    expect(flashes.get("save_template")).toBe("saved=template");
    expect(flashes.get("delete_template")).toBe("saved=template");
    expect(flashes.get("reset_templates")).toBe("saved=template");

    const settings = readFileSync(new URL("../app/routes/settings.tsx", import.meta.url), "utf8");
    expect(settings).toContain('sp.get("saved") === "profile"');
    expect(settings).toContain('sp.get("saved") === "password"');
    expect(settings).toContain('sp.get("saved") === "email"');
    expect(settings).toContain('sp.get("saved") === "member"');
  });

  it("uses flag(returnTo, key, val) for every success redirect", () => {
    expect(actionSrc).toContain('function flag(returnTo: string, key: string, val: string)');
    for (const flash of Object.values(INTENT_FLASH)) {
      const [key, val] = flash.split("=");
      expect(actionSrc).toContain(`flag(returnTo, "${key}", "${val}")`);
    }
  });
});

describe("settings forms check only their own saved key (NP-AUD-2026-115)", () => {
  const sources = Object.fromEntries(FORM_SAVED.map((f) => [f.file, readComponent(f.file)]));

  it("each form lights Saved. only for its own key", () => {
    for (const { file, keys } of FORM_SAVED) {
      expect(savedEquals(sources[file]), file).toEqual(keys);
      expect(sources[file], file).not.toContain('sp.get("saved") === "1"');
    }
  });

  it("saving late fees does not light the workflow form (negative)", () => {
    const lateFees = sources["LateFeesForm.tsx"];
    const workflow = sources["WorkflowSettingsForm.tsx"];
    const priority = sources["PriorityThresholdsForm.tsx"];
    const rules = sources["CollectionsRulesForm.tsx"];

    expect(savedEquals(lateFees)).toEqual(["late_fees"]);
    expect(savedEquals(workflow)).not.toContain("late_fees");
    expect(savedEquals(priority)).not.toContain("late_fees");
    expect(savedEquals(rules)).not.toContain("late_fees");
    expect(workflow).not.toContain("late_fees");
  });

  it("email panel keeps email_saved and does not read saved", () => {
    const email = readComponent("EmailSettingsSection.tsx");
    expect(email).toContain('sp.get("email_saved") === "1"');
    expect(email).toContain('testResult === "from_allowlist"');
    expect(email).toContain('errorCode === "from_allowlist"');
    expect(savedEquals(email)).toEqual([]);
  });

  it("save_email preserves from_allowlist instead of collapsing to error=email", () => {
    expect(actionSrc).toContain('parsed.error === "from_allowlist"');
    expect(actionSrc).toContain('"from_allowlist" : "email"');
  });
});
