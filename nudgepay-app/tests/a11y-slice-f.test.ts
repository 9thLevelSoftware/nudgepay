import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("TEMP-UX-014 reduced motion", () => {
  it("disables animation and transition when prefers-reduced-motion is set", () => {
    const css = read("../app/app.css");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/animation:\s*none\s*!important/);
    expect(css).toMatch(/transition:\s*none\s*!important/);
  });

  it("keeps ThermalBand static", () => {
    const src = read("../app/components/ThermalBand.tsx");
    expect(src).not.toMatch(/animate-|transition-/);
  });
});

describe("TEMP-UX-015 queue table roles", () => {
  const src = read("../app/components/WorkQueue.tsx");
  const row = src.slice(src.indexOf("function QueueRow"), src.indexOf("function MobileCard"));

  it("uses table/row/columnheader/cell on the md+ QUEUE_GRID", () => {
    expect(src).toContain('role="table"');
    expect(src).toContain('role="row"');
    expect(src).toContain('role="columnheader"');
    expect(src).toContain('role="cell"');
    expect(src).toContain("QUEUE_GRID");
    expect(src).toContain("QUEUE_GRID_CUST_DETAILED");
    expect(src).toContain("QUEUE_GRID_CUST_RISK");
    expect(src).toContain("QUEUE_GRID_INV_GENERAL");
    expect(src).toContain("QUEUE_GRID_INV_DETAILED");
    expect(src).toContain("QUEUE_GRID_INV_RISK");
    expect(src).toContain('data-label="Peek"');
    expect(src).toContain('data-label="Payer"');
    expect(src).not.toContain('role="tablist"');
    expect(src).toContain("aria-pressed={density === id}");
  });

  it("owns Heat/Customer cells from the row, not via a spanning Open link", () => {
    expect(row).toContain('role="row"');
    expect(row).not.toMatch(/aria-label=\{`Open \$\{item\.customerName\}`\}/);
    const heatCell = row.indexOf('role="cell" data-label="Heat"');
    const customerCell = row.indexOf('role="cell" data-label="Customer"');
    const customerLink = row.indexOf("<Link");
    const overdueCell = row.indexOf('role="cell" data-label="Total overdue"');
    expect(heatCell).toBeGreaterThan(-1);
    expect(customerCell).toBeGreaterThan(heatCell);
    expect(customerLink).toBeGreaterThan(customerCell);
    expect(overdueCell).toBeGreaterThan(customerLink);
    expect(row.slice(customerLink, overdueCell)).not.toContain('role="cell"');
    expect(row).toContain("cursor-pointer");
    expect(row).toContain("onClick={() => navigate(href)}");
    expect(row).toMatch(/Send text to \$\{item\.customerName\}[\s\S]*onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it("keeps mobile cards as a list", () => {
    expect(src).toMatch(/md:hidden[\s\S]{0,80}role="list"/);
    expect(src).toContain('role="listitem"');
  });
});

describe("TEMP-UX-016 live regions", () => {
  it("names WebhookUrlField copy and announces Copied", () => {
    const src = read("../app/components/WebhookUrlField.tsx");
    expect(src).toContain("aria-label={`Copy ${label} URL`}");
    expect(src).toContain('aria-live="polite"');
    expect(src).toMatch(/min-h-6[\s\S]{0,80}Copy \$\{label\} URL|Copy \$\{label\} URL[\s\S]{0,200}min-h-6/);
  });

  it("exposes BulkActionBar count as a status", () => {
    const src = read("../app/components/BulkActionBar.tsx");
    expect(src).toContain('role="status"');
  });

  it("exposes the AppShell loading bar to AT", () => {
    const src = read("../app/components/AppShell.tsx");
    expect(src).toContain('role="progressbar"');
    expect(src).toContain('aria-label="Loading"');
    expect(src).toContain("motion-reduce:opacity-100");
    expect(src).not.toMatch(/role="progressbar"[^>]*aria-hidden="true"/);
  });
});

describe("TEMP-UX-013 WebhookUrlField label", () => {
  it("wires the visible label with htmlFor and input id", () => {
    const src = read("../app/components/WebhookUrlField.tsx");
    expect(src).toContain("htmlFor={inputId}");
    expect(src).toContain("id={inputId}");
    expect(src).not.toMatch(/<span className="text-xs font-medium text-muted">\{label\}<\/span>/);
  });
});

describe("TEMP-UX-020 CommPrefsDrawer scrim", () => {
  it("hides the scrim from AT without labeling it Close", () => {
    // CommPrefsDrawer delegates the scrim to the shared DrawerShell.
    const src = read("../app/components/DrawerShell.tsx");
    expect(src).toMatch(/aria-hidden="true"\s+tabIndex=\{-1\}/);
    expect(src).not.toMatch(/aria-hidden="true"[^>]*aria-label="Close"/);
  });
});

describe("TEMP-UX-019 TemplateEditor channel toggle", () => {
  it("uses aria-pressed instead of a fake tablist", () => {
    const src = read("../app/components/TemplateEditor.tsx");
    expect(src).not.toContain('role="tablist"');
    expect(src).not.toContain('role="tab"');
    expect(src).toContain("aria-pressed={channel === \"sms\"}");
    expect(src).toContain("aria-pressed={channel === \"email\"}");
  });
});

describe("consistent help (WCAG 3.2.6)", () => {
  it("exposes one Support mailto on public chrome and in the account menu", () => {
    const meta = read("../app/lib/meta.ts");
    expect(meta).toContain('export const SUPPORT_EMAIL = "support@nudgepay-ar.app"');
    expect(meta).toContain("export const SUPPORT_MAILTO");
    const pub = read("../app/components/PublicLayout.tsx");
    expect(pub).toContain("SUPPORT_MAILTO");
    expect(pub).toContain(">Support</a>");
    const shell = read("../app/components/AppShell.tsx");
    expect(shell).toContain("SUPPORT_MAILTO");
    expect(shell).toContain("Support");
    const focus = read("../app/routes/focus.tsx");
    expect(focus).toContain("SUPPORT_MAILTO");
    expect(focus).toContain("Support");
    const unsub = read("../app/routes/unsubscribe.tsx");
    expect(unsub).toContain("SUPPORT_MAILTO");
    expect(unsub).toContain("Support");
    const palette = read("../app/components/CommandPalette.tsx");
    expect(palette).toContain("SUPPORT_MAILTO");
    expect(palette).toContain("Contact Support");
    expect(palette).toContain('command.href.startsWith("mailto:")');
    const privacy = read("../app/routes/privacy.tsx");
    expect(privacy).toContain("SUPPORT_EMAIL");
    expect(privacy).not.toMatch(/const contact = "support@nudgepay-ar.app"/);
  });
});

describe("pointer target size (WCAG 2.5.8)", () => {
  it("keeps icon-only chrome at least 32×32 CSS pixels", () => {
    const ui = read("../app/components/ui.tsx");
    expect(ui).toContain("export const ICON_HIT_CLASS");
    expect(ui).toContain("w-8 h-8 min-w-8 min-h-8");
    expect(ui).toMatch(/icon:\s*"w-9 h-9[\s\S]*min-w-9 min-h-9"/);
    const shell = read("../app/components/AppShell.tsx");
    expect(shell).toContain("ICON_HIT_CLASS");
    expect(shell).not.toMatch(/w-7 h-7 rounded-full bg-copper\/20[\s\S]*aria-label=\{`Account menu/);
    const detail = read("../app/components/DetailPanel.tsx");
    expect(detail).toContain("ICON_HIT_CLASS");
    expect(detail).not.toMatch(/w-6 h-6 rounded text-surface\/60[\s\S]*Close detail panel/);
    const logContact = read("../app/components/LogContactDrawer.tsx");
    expect(logContact).toContain("ICON_HIT_CLASS");
    expect(logContact).toContain('aria-label="Close"');
    expect(logContact).not.toMatch(/aria-label="Close"[\s\S]{0,200}p-1/);
    const templates = read("../app/components/TemplateEditor.tsx");
    expect(templates).toContain("aria-label={`Insert {${k}}`}");
    expect(templates).toMatch(/aria-label=\{`Insert \{\$\{k\}\}`\}[\s\S]{0,220}min-h-6/);
    expect(templates).not.toMatch(/aria-label=\{`Insert \{\$\{k\}\}`\}[\s\S]{0,220}py-0\.5/);
    const bulk = read("../app/components/BulkSmsDrawer.tsx");
    expect(bulk).toMatch(/onClose[\s\S]{0,120}min-h-6/);
    const comm = read("../app/components/CommPrefsDrawer.tsx");
    expect(comm).toMatch(/min-h-6[\s\S]{0,160}>Close<\/Link>/);
  });
});

describe("accessible authentication (WCAG 3.3.8)", () => {
  it("lets password managers fill login, signup, reset, and settings", () => {
    const login = read("../app/routes/login.tsx");
    expect(login).toContain('autoComplete="email"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).not.toMatch(/onPaste|onCopy|onCut/);
    const signup = read("../app/routes/signup.tsx");
    expect(signup).toContain('autoComplete="email"');
    expect(signup).toContain('autoComplete="new-password"');
    expect(signup).not.toMatch(/onPaste|onCopy|onCut/);
    const forgot = read("../app/routes/forgot-password.tsx");
    expect(forgot).toContain('autoComplete="email"');
    const reset = read("../app/routes/reset-password.tsx");
    expect(reset).toMatch(/name="password"[\s\S]*autoComplete="new-password"/);
    expect(reset).toMatch(/name="confirm"[\s\S]*autoComplete="new-password"/);
    expect(reset).not.toMatch(/onPaste|onCopy|onCut/);
    const settings = read("../app/routes/settings.tsx");
    expect(settings).toContain('autoComplete="current-password"');
    expect(settings).toContain('autoComplete="new-password"');
  });
});

describe("skip to content", () => {
  it("is a shared primitive targeting main-content", () => {
    const src = read("../app/components/ui.tsx");
    expect(src).toContain('export const MAIN_CONTENT_ID = "main-content"');
    expect(src).toContain("export function SkipLink");
    expect(src).toContain("Skip to content");
    expect(src).toContain("sr-only focus:not-sr-only");
  });

  it("AppShell, PublicLayout, Focus, and unsubscribe use SkipLink", () => {
    for (const rel of [
      "../app/components/AppShell.tsx",
      "../app/components/PublicLayout.tsx",
      "../app/routes/focus.tsx",
      "../app/routes/unsubscribe.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("<SkipLink");
      expect(src, rel).toContain("MAIN_CONTENT_ID");
      expect(src, rel).toContain("tabIndex={-1}");
      expect(src, rel).not.toMatch(/href="#main-content"/);
    }
  });
});
