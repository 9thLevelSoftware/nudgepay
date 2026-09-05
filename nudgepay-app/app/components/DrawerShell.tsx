// DrawerShell — right-side sheet (the universal overlay pattern for the app).
// Renders over content with a scrim; traps focus, closes on Escape, and
// restores focus on close via the shared useDialog hook.
//
// URL-driven mobile detail drawers include a visible close control in addition
// to scrim/Escape handling so full-width touch layouts always have an exit.

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDialog } from "../lib/use-dialog";
import { Button, buttonBase, buttonVariants, cx } from "./ui";

export function DrawerShell({
  label,
  onClose,
  closeHref,
  children,
  className = "",
  maxWidth = "max-w-md",
  initialFocusRef,
  padded = true,
  mobileOnly = false,
}: {
  /** Accessible name for the dialog. */
  label: string;
  /** Called on scrim click and Escape (local-state drawers). */
  onClose?: () => void;
  /** URL-driven scrim/close target (URL-is-state-of-record drawers). */
  closeHref?: string;
  children: React.ReactNode;
  className?: string;
  /** Tailwind max-width for the panel. Default matches existing drawers. */
  maxWidth?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Whether the panel gets default padding; false if content provides it. */
  padded?: boolean;
  /** Enables a drawer only below the Tailwind lg breakpoint. */
  mobileOnly?: boolean;
}) {
  const close = onClose ?? (() => {});
  // Render the selected mobile detail during SSR. Registration waits until the
  // browser has established the breakpoint, preventing a hidden desktop sheet
  // from trapping focus or inerting the page.
  const [matchesViewport, setMatchesViewport] = useState(true);
  const [viewportReady, setViewportReady] = useState(!mobileOnly);

  useEffect(() => {
    if (!mobileOnly) return;
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setMatchesViewport(query.matches);
      setViewportReady(true);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [mobileOnly]);
  // For URL-driven drawers, Escape must navigate; the scrim is a Link.
  const { panelRef, layerRef } = useDialog({
    onClose: close,
    enabled: !mobileOnly || (viewportReady && matchesViewport),
    onCloseHref: closeHref,
    initialFocusRef,
  });

  const drawer = (
    <div
      ref={layerRef}
      data-dialog-layer=""
      className={cx("fixed inset-0 z-[60] flex justify-end", mobileOnly && "lg:hidden")}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {closeHref ? (
        <Link
          to={closeHref}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 bg-ink/40 motion-safe:transition-opacity"
        />
      ) : (
        <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          "relative z-[70] flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-panel",
          padded && "gap-4 p-5",
          maxWidth,
          className,
        )}
      >
        {mobileOnly ? (
          closeHref ? (
            <Link
              to={closeHref}
              aria-label={`Close ${label}`}
              className={cx(buttonBase, buttonVariants.secondary, "ml-auto inline-flex size-11 shrink-0 items-center justify-center bg-panel text-xl leading-none")}
            >
              <span aria-hidden="true">×</span>
            </Link>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={close}
              aria-label={`Close ${label}`}
              className="ml-auto size-11 shrink-0 px-0 text-xl leading-none"
            >
              <span aria-hidden="true">×</span>
            </Button>
          )
        ) : null}
        {children}
      </div>
    </div>
  );

  return typeof document === "undefined" ? drawer : createPortal(drawer, document.body);
}
