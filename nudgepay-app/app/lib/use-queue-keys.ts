// Keyboard shortcut hook for the work queue: j (next), k (prev), x (toggle
// bulk checkbox). Same guards as use-focus-keys.ts: modifier keys and
// editable element targets are ignored.

import { useEffect } from "react";

export type QueueKey = "j" | "k" | "x";

export function useQueueKeys(opts: {
  enabled: boolean;
  onAction: (key: QueueKey) => void;
}): void {
  const { enabled, onAction } = opts;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "j") onAction("j");
      else if (e.key === "k") onAction("k");
      else if (e.key === "x") onAction("x");
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onAction]);
}
