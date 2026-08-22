// Confirm — styled async confirm that replaces native window.confirm.
//
// Mount <ConfirmProvider> once near the app root (routes that need it). Any
// descendant calls `useConfirm()(options)` and awaits a boolean. Renders a
// focus-trapped ModalShell — consistent with the app's overlay system and
// fully keyboard/screen-reader friendly, unlike a native dialog.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ModalShell } from "./ModalShell";
import { Button } from "./ui";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "destructive" | "primary";
}

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return confirm;
}

interface OpenState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenState | null>(null);

  const confirm = useCallback<ConfirmContextValue>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setOpen({ ...options, resolve });
      }),
    [],
  );

  function settle(value: boolean) {
    setOpen((cur) => {
      cur?.resolve(value);
      return null;
    });
  }

  const tone = open?.tone ?? "primary";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open ? (
        <ModalShell label={open.title ?? "Confirm"} onClose={() => settle(false)} maxWidth="max-w-sm">
          {open.title ? (
            <h2 className="font-display text-lg font-semibold text-text mb-1">{open.title}</h2>
          ) : null}
          <p className="text-sm font-sans text-text mb-4">{open.message}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => settle(false)}>
              {open.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              type="button"
              variant={tone === "destructive" ? "destructive" : "primary"}
              size="sm"
              onClick={() => settle(true)}
            >
              {open.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </ModalShell>
      ) : null}
    </ConfirmContext.Provider>
  );
}
