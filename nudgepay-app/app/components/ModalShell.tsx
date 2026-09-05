// ModalShell — centered dialog. Use sparingly; right-side DrawerShell is the
// app's default overlay pattern. Reserve this for focused, blocking prompts
// (e.g. ConfirmDialog). Traps focus, closes on Escape / scrim.

import { createPortal } from "react-dom";
import { useDialog } from "../lib/use-dialog";
import { cx } from "./ui";

export function ModalShell({
  label,
  onClose,
  children,
  className = "",
  maxWidth = "max-w-lg",
  initialFocusRef,
  labelledBy,
  describedBy,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Uses visible dialog content as its accessible name when supplied. */
  labelledBy?: string;
  /** References supporting dialog copy, such as a destructive-action warning. */
  describedBy?: string;
}) {
  const { panelRef, layerRef } = useDialog({ onClose, initialFocusRef });

  const modal = (
    <div
      ref={layerRef}
      data-dialog-layer=""
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          "w-full rounded-lg border border-border bg-surface p-4 shadow-panel",
          maxWidth,
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
