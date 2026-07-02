import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behavior for modal drawers/panels: traps Tab focus within the
 * panel, closes on Escape, and returns focus to the element that triggered
 * the dialog when it unmounts.
 */
export function useDialog(opts: {
  onClose: () => void;
  enabled?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}): { panelRef: React.RefObject<HTMLDivElement | null> } {
  const { onClose, enabled = true, initialFocusRef } = opts;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;

    const captured = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusTarget =
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      null;
    focusTarget?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panelEl = panelRef.current;
      if (!panelEl) return;
      const focusable = panelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (captured?.isConnected) captured.focus();
      else document.getElementById("main-content")?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { panelRef };
}
