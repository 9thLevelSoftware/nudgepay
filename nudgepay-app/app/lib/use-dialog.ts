import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { isTopDialog, registerDialogLayer, topDialogLayer } from "./dialog-manager";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isUsableFocusable(element: HTMLElement): boolean {
  return !element.matches("[disabled], [hidden], [aria-hidden='true']") &&
    !element.closest("[inert], [hidden], [aria-hidden='true']") &&
    element.getClientRects().length > 0;
}

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isUsableFocusable);
}

function restoreFocus(captured: HTMLElement | null) {
  if (captured && captured !== document.body && captured !== document.documentElement && captured.isConnected && isUsableFocusable(captured)) {
    captured.focus();
    return;
  }

  const lowerLayer = topDialogLayer();
  if (lowerLayer) {
    const target = focusableIn(lowerLayer)[0] ?? lowerLayer.querySelector<HTMLElement>("[tabindex='-1']");
    target?.focus();
    return;
  }

  document.getElementById("main-content")?.focus();
}

/**
 * Shared dialog behavior for modal drawers/panels: traps Tab focus within the
 * panel, closes on Escape, and returns focus to the element that triggered
 * the dialog when it unmounts.
 *
 * For URL-as-state drawers, pass `onCloseHref` and Escape/nav-close follows
 * a router navigation instead of `onClose`.
 */
export function useDialog(opts: {
  onClose: () => void;
  enabled?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onCloseHref?: string;
}): { panelRef: React.RefObject<HTMLDivElement | null>; layerRef: React.RefObject<HTMLDivElement | null> } {
  const { onClose, enabled = true, initialFocusRef, onCloseHref } = opts;
  const panelRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;

    const layer = layerRef.current;
    if (!layer) return;
    const captured = document.activeElement as HTMLElement | null;
    const { id, unregister } = registerDialogLayer(layer);

    const panel = panelRef.current;
    const initialFocus = initialFocusRef?.current;
    const focusTarget =
      (initialFocus && isUsableFocusable(initialFocus) ? initialFocus : null) ??
      (panel ? focusableIn(panel)[0] : null) ??
      panel ??
      null;
    focusTarget?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (!isTopDialog(id)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (onCloseHref) navigate(onCloseHref);
        else onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panelEl = panelRef.current;
      if (!panelEl) return;
      const focusable = focusableIn(panelEl);
      if (focusable.length === 0) {
        e.preventDefault();
        panelEl.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelEl.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panelEl.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const wasTop = isTopDialog(id);
      unregister();
      if (wasTop) restoreFocus(captured);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { panelRef, layerRef };
}
