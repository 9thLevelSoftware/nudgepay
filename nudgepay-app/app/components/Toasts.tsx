// Toasts — shared, transient notification stack (extracted from focus mode).
//
// Mount <ToastProvider> once near the app frame. Descendants call
// `useToast()` for a `push(text, tone?)` function. Toasts auto-dismiss after
// 4s, stack bottom-right, and announce to screen readers via role=status
// (or role=alert for "err"). This replaces static `?saved=` URL params for
// action confirmations.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "./ui";

export type ToastTone = "ok" | "warn" | "err" | "info";

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

type PushToast = (text: string, tone?: ToastTone) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

const toneClasses: Record<ToastTone, string> = {
  ok: "border-cool/30",
  info: "border-white/10",
  warn: "border-warm/40",
  err: "border-hot/40",
};

const toneRole = (tone: ToastTone) => (tone === "err" || tone === "warn" ? "alert" : "status");

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback<PushToast>((text, tone = "ok") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={toneRole(t.tone)}
            className={cx(
              "pointer-events-auto animate-[fade-in_200ms_ease-in] rounded-lg border bg-ink/95 px-4 py-2 text-sm text-surface shadow-lg backdrop-blur",
              toneClasses[t.tone],
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
