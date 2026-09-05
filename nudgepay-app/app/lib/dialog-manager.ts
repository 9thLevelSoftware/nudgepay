// Document-level coordination for the shared modal and drawer shells. Keeping
// this outside the hook makes nested overlays behave as one stack.

type DialogEntry = {
  id: symbol;
  layer: HTMLElement;
};

let entries: DialogEntry[] = [];
let savedBodyOverflow: string | null = null;
const savedState = new WeakMap<HTMLElement, { ariaHidden: string | null; inert: boolean }>();

function setInert(element: HTMLElement, inert: boolean) {
  if (inert) {
    if (!savedState.has(element)) {
      savedState.set(element, {
        ariaHidden: element.getAttribute("aria-hidden"),
        inert: element.inert,
      });
    }
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
    return;
  }

  const previous = savedState.get(element);
  if (!previous) return;
  element.inert = previous.inert;
  if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", previous.ariaHidden);
  savedState.delete(element);
}

function syncDocument() {
  if (typeof document === "undefined") return;

  entries = entries.filter((entry) => entry.layer.isConnected);
  const top = entries.at(-1)?.layer ?? null;
  for (const child of Array.from(document.body.children)) {
    const element = child as HTMLElement;
    // The current overlay remains exposed. Background siblings and lower
    // overlays are unavailable until the top layer closes.
    setInert(element, top !== null && element !== top);
  }

  if (top) {
    if (savedBodyOverflow === null) savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else if (savedBodyOverflow !== null) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
}

export function registerDialogLayer(layer: HTMLElement): { id: symbol; unregister: () => void } {
  const id = Symbol("dialog");
  entries.push({ id, layer });
  syncDocument();

  return {
    id,
    unregister() {
      entries = entries.filter((entry) => entry.id !== id);
      syncDocument();
    },
  };
}

export function isTopDialog(id: symbol): boolean {
  return entries.at(-1)?.id === id;
}

/** Popovers use this to leave Escape and focus restoration to a modal on top. */
export function hasOpenDialogs(): boolean {
  return entries.length > 0;
}

export function topDialogLayer(): HTMLElement | null {
  return entries.at(-1)?.layer ?? null;
}
