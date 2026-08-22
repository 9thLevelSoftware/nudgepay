// ModalShell — centered dialog. Use sparingly; right-side DrawerShell is the
// app's default overlay pattern. Reserve this for focused, blocking prompts
// (e.g. ConfirmDialog). Traps focus, closes on Escape / scrim.

import { useDialog } from "../lib/use-dialog";
import { cx } from "./ui";

export function ModalShell({
  label,
  onClose,
  children,
  className = "",
  maxWidth = "max-w-lg",
  initialFocusRef,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { panelRef } = useDialog({ onClose, initialFocusRef });

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        ref={panelRef}
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
}
