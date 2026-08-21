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

  it("uses table/row/columnheader/cell on the md+ QUEUE_GRID", () => {
    expect(src).toContain('role="table"');
    expect(src).toContain('role="row"');
    expect(src).toContain('role="columnheader"');
    expect(src).toContain('role="cell"');
    expect(src).toContain("QUEUE_GRID");
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
  });

  it("exposes BulkActionBar count as a status", () => {
    const src = read("../app/components/BulkActionBar.tsx");
    expect(src).toContain('role="status"');
  });

  it("exposes the AppShell loading bar to AT", () => {
    const src = read("../app/components/AppShell.tsx");
    expect(src).toContain('role="progressbar"');
    expect(src).toMatch(/sr-only">Loading/);
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
    const src = read("../app/components/CommPrefsDrawer.tsx");
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
