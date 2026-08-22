import { useEffect, useState } from "react";
import { Icon } from "./Icons";

export type ThemeMode = "light" | "dark";

const THEME_COOKIE = "nudgepay-theme";
const THEME_STORAGE_KEY = "nudgepay-theme";

function setTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private browsing; the cookie still persists.
  }
  document.cookie = `${THEME_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ThemeToggle() {
  const [theme, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setMode(current);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        setMode(next);
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-sans text-on-ink/80 hover:bg-on-ink/5 hover:text-on-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
      aria-label={`Use ${next} theme`}
      title={`Use ${next} theme`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
      <span>{theme === "dark" ? "Use light theme" : "Use dark theme"}</span>
    </button>
  );
}

export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var cookie = document.cookie.match(/(?:^|; )nudgepay-theme=(dark|light)/);
    var saved = cookie && cookie[1];
    if (!saved) saved = localStorage.getItem("nudgepay-theme");
    var dark = saved === "dark" || (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var theme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {}
})();
`;
