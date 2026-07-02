import { useEffect } from "react";
import { useSearchParams } from "react-router";

// Flash params are result notifications that should be cleaned from the URL
// after they're rendered so a page refresh doesn't show stale feedback.
//
// Structural params (view, sort, q, case, tab, invoice, channel, customerId)
// are NOT flash params — they drive UI state and must survive.
//
// Some flash-param names can also drive open drawers when their value is "1"
// or similar (e.g., log=1 opens LogContactDrawer). We skip those when they
// carry a UI-mounting value, stripping them only when they carry a result
// value (e.g., sms=sent, email=error).
const FLASH_PARAMS = [
  "saved", "sms", "email", "logError", "promiseError",
  "bulkAssign", "count", "bulkSms", "sent", "failed", "skipped",
  "email_saved", "error",
];

// These params drive open UI when they have specific values; only strip if
// they aren't currently mounting something.
const DRAWER_PARAMS: Record<string, (v: string) => boolean> = {
  log: (v) => v !== "1",       // log=1 mounts LogContactDrawer
  method: () => false,         // always accompanies log=1, skip while drawer open
  prefs: (v) => v !== "1",    // prefs=1 mounts CommPrefsDrawer
};

export function useFlashCleanup() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    for (const key of FLASH_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    for (const [key, shouldStrip] of Object.entries(DRAWER_PARAMS)) {
      const val = url.searchParams.get(key);
      if (val !== null && shouldStrip(val)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    if (changed) {
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [searchParams]);
}
