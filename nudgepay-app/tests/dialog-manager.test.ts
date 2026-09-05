import { afterEach, describe, expect, it } from "vitest";
import { isTopDialog, registerDialogLayer, topDialogLayer } from "../app/lib/dialog-manager";

class FakeElement {
  inert = false;
  isConnected = true;
  private attributes = new Map<string, string>();

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

function installDocument(children: FakeElement[]) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { body: { children, style: { overflow: "scroll" } } },
  });
}

describe("dialog manager", () => {
  it("locks the page, inerts the background, and restores its existing state", () => {
    const app = new FakeElement();
    const layer = new FakeElement();
    app.setAttribute("aria-hidden", "false");
    installDocument([app, layer]);

    const dialog = registerDialogLayer(layer as unknown as HTMLElement);

    expect(app.inert).toBe(true);
    expect(app.getAttribute("aria-hidden")).toBe("true");
    expect(layer.inert).toBe(false);
    expect((document.body.style as CSSStyleDeclaration).overflow).toBe("hidden");
    expect(isTopDialog(dialog.id)).toBe(true);

    dialog.unregister();

    expect(app.inert).toBe(false);
    expect(app.getAttribute("aria-hidden")).toBe("false");
    expect((document.body.style as CSSStyleDeclaration).overflow).toBe("scroll");
  });

  it("only exposes the top layer while nested dialogs are open", () => {
    const app = new FakeElement();
    const firstLayer = new FakeElement();
    const secondLayer = new FakeElement();
    installDocument([app, firstLayer, secondLayer]);

    const first = registerDialogLayer(firstLayer as unknown as HTMLElement);
    const second = registerDialogLayer(secondLayer as unknown as HTMLElement);

    expect(isTopDialog(first.id)).toBe(false);
    expect(isTopDialog(second.id)).toBe(true);
    expect(topDialogLayer()).toBe(secondLayer);
    expect(firstLayer.inert).toBe(true);
    expect(secondLayer.inert).toBe(false);

    second.unregister();

    expect(isTopDialog(first.id)).toBe(true);
    expect(topDialogLayer()).toBe(firstLayer);
    expect(firstLayer.inert).toBe(false);
    first.unregister();
    expect(topDialogLayer()).toBeNull();
  });
});
