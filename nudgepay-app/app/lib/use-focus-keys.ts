// Keyboard shortcut hook for Focus Mode: 1 (log call), 2 (send text),
// 3 (snooze), space (skip). Disabled when a mini-form is open (digits need
// to type into note fields) or when focus is in an input/textarea/select.

import { useEffect } from "react";

export type FocusKey = "1" | "2" | "3" | "space";

export function useFocusKeys(opts: {
  enabled: boolean;
  onAction: (key: FocusKey) => void;
}): void {
  const { enabled, onAction } = opts;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore when a modifier is held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignore when focus is in an editable element
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "1") onAction("1");
      else if (e.key === "2") onAction("2");
      else if (e.key === "3") onAction("3");
      else if (e.key === " ") {
        e.preventDefault(); // prevent page scroll
        onAction("space");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onAction]);
}
