import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("shared dialog shells", () => {
  it("renders modal layers at document level with a focusable panel fallback", () => {
    for (const rel of ["../app/components/DrawerShell.tsx", "../app/components/ModalShell.tsx"]) {
      const source = read(rel);
      expect(source).toContain('data-dialog-layer=""');
      expect(source).toContain("createPortal");
      expect(source).toContain("document.body");
      expect(source).toContain("tabIndex={-1}");
    }
  });

  it("keeps CSS-hidden list drawers out of the dialog stack at desktop widths", () => {
    const shell = read("../app/components/DrawerShell.tsx");
    expect(shell).toContain('mobileOnly && "lg:hidden"');
    expect(shell).toContain("viewportReady && matchesViewport");
    for (const rel of ["../app/routes/accounts.tsx", "../app/routes/messages.tsx", "../app/routes/promises.tsx"]) {
      expect(read(rel), rel).toMatch(/<DrawerShell[\s\S]{0,400}mobileOnly/);
    }
  });

  it("traps focus on the panel when there are no focusable descendants and only closes the top dialog", () => {
    const source = read("../app/lib/use-dialog.ts");
    expect(source).toContain("if (!isTopDialog(id)) return;");
    expect(source).toMatch(/focusable\.length === 0[\s\S]{0,100}panelEl\.focus\(\)/);
    expect(source).toContain("getClientRects().length > 0");
    expect(source).toContain("const wasTop = isTopDialog(id);");
    expect(source).toContain("captured !== document.body");
    expect(source).toContain("const lowerLayer = topDialogLayer();");
  });

  it("supports visible labels and descriptions for semantic dialogs", () => {
    const modal = read("../app/components/ModalShell.tsx");
    expect(modal).toContain("labelledBy?: string");
    expect(modal).toContain("describedBy?: string");
    expect(modal).toContain("aria-labelledby={labelledBy}");
    expect(modal).toContain("aria-describedby={describedBy}");
    const settings = read("../app/routes/settings.tsx");
    expect(settings).toContain('labelledBy="qbo-disconnect-title"');
    expect(settings).toContain('describedBy="qbo-disconnect-desc"');
  });

  it("keeps popovers open while a higher dialog owns Escape", () => {
    for (const rel of ["../app/components/AppShell.tsx", "../app/components/SyncIssues.tsx"]) {
      const source = read(rel);
      expect(source, rel).toContain("hasOpenDialogs");
      expect(source, rel).toContain('e.key === "Escape" && !hasOpenDialogs()');
    }
    for (const rel of ["../app/components/DrawerShell.tsx", "../app/components/ModalShell.tsx"]) {
      expect(read(rel), rel).toContain("z-[60]");
    }
  });
});
