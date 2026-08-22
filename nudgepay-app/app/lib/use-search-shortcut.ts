import { useEffect, useRef } from "react";

/** Focus the surface's primary search field with `/` when not typing elsewhere. */
export function useSearchShortcut<T extends HTMLInputElement = HTMLInputElement>(enabled = true) {
  const searchRef = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (!target || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (target.closest('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  return searchRef;
}
