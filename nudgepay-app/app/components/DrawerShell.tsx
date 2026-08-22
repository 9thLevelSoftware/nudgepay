// DrawerShell — right-side sheet (the universal overlay pattern for the app).
// Renders over content with a scrim; traps focus, closes on Escape, and
// restores focus on close via the shared useDialog hook.
//
// `close` is handled by the consumer: either Link-based (URL is state of
// record) or a callback for local-state drawers. Provide `onClose` for the
// scrim/Esc behaviour and render your own close control inside when needed.

import { Link } from "react-router";
import { useDialog } from "../lib/use-dialog";
import { cx } from "./ui";

export function DrawerShell({
  label,
  onClose,
  closeHref,
  children,
  className = "",
  maxWidth = "max-w-md",
  initialFocusRef,
  padded = true,
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
}) {
  const close = onClose ?? (() => {});
  // For URL-driven drawers, Escape must navigate; the scrim is a Link.
  const { panelRef } = useDialog({
    onClose: close,
    enabled: true,
    onCloseHref: closeHref,
    initialFocusRef,
  });

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
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
        className={cx(
          "relative z-50 flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-panel",
          padded && "gap-4 p-5",
          maxWidth,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
