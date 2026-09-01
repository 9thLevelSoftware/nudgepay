import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("click-to-page latency", () => {
  it("places the Worker next to Supabase Oregon instead of the user edge", () => {
    const toml = read("../wrangler.toml");
    expect(toml).toMatch(/\[placement\][\s\S]*mode = "smart"/);
    expect(toml).toMatch(/\[env\.production\.placement\][\s\S]*mode = "smart"/);
    expect(toml).toMatch(/\[env\.staging\.placement\][\s\S]*mode = "smart"/);
  });

  it("self-hosts fonts instead of Google Fonts", () => {
    const root = read("../app/root.tsx");
    expect(root).not.toContain("fonts.googleapis.com");
    expect(root).not.toContain("fonts.gstatic.com");
    expect(root).toContain("@fontsource-variable/ibm-plex-sans/wght.css");
    expect(root).toContain("@fontsource-variable/space-grotesk/wght.css");
    expect(root).toContain("@fontsource/ibm-plex-mono/latin-400.css");
    const css = read("../app/app.css");
    expect(css).toContain("IBM Plex Sans Variable");
    expect(css).toContain("Space Grotesk Variable");
  });

  it("starts dashboard chrome reads before awaiting org config", () => {
    const src = read("../app/routes/dashboard.tsx");
    const configIdx = src.indexOf("const orgConfigP = loadOrgConfig");
    const chromeIdx = src.indexOf("const chromeP = Promise.all");
    const awaitConfigIdx = src.indexOf("await orgConfigP");
    expect(configIdx).toBeGreaterThan(-1);
    expect(chromeIdx).toBeGreaterThan(configIdx);
    expect(awaitConfigIdx).toBeGreaterThan(chromeIdx);
    expect(src).toContain("chromeP");
  });

  it("loads org config inside workspace chrome so list routes skip a serial RTT", () => {
    const chrome = read("../app/lib/workspace.server.ts");
    expect(chrome).toContain("loadOrgConfig(supabase, org.org_id)");
    expect(chrome).toContain("orgConfig");
    expect(read("../app/routes/accounts.tsx")).not.toContain("loadOrgConfig(");
    expect(read("../app/routes/promises.tsx")).not.toContain("loadOrgConfig(");
    expect(read("../app/routes/messages.tsx")).not.toContain("loadOrgConfig(");
    expect(read("../app/routes/settings.tsx")).not.toContain("loadOrgConfig(");
  });

  it("runs accounts last-contact queries in the first parallel batch", () => {
    const src = read("../app/routes/accounts.tsx");
    expect(src).toMatch(/const \[custPage, invPage, casePage, logPage, msgPage, emailPage, roster\] = await Promise\.all/);
  });
});
