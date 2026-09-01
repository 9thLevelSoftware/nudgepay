import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Icon } from "./Icons";
import { ModalShell } from "./ModalShell";
import { Button, Input, Kbd } from "./ui";
import { SUPPORT_MAILTO } from "../lib/meta";

type PaletteMode = "commands" | "shortcuts" | null;

type Command = {
  label: string;
  hint: string;
  href: string;
};

const NAV_COMMANDS: Command[] = [
  { label: "Go to Collections", hint: "Dashboard", href: "/dashboard" },
  { label: "Go to Accounts", hint: "Directory", href: "/accounts" },
  { label: "Go to Promises", hint: "Ledger", href: "/promises" },
  { label: "Go to Messages", hint: "Inbox", href: "/messages" },
  { label: "Go to Reports", hint: "Owner-only", href: "/reports" },
  { label: "Open Settings", hint: "Workspace", href: "/settings" },
  { label: "Open Focus Mode", hint: "Triage deck", href: "/focus" },
  { label: "Contact Support", hint: "Email", href: SUPPORT_MAILTO },
];

const SHORTCUTS = [
  ["Ctrl K / Cmd K", "Open command palette"],
  ["?", "Show keyboard shortcuts"],
  ["/", "Focus the current search field"],
  ["Esc", "Close an overlay"],
  ["j / k", "Move through the Collections queue"],
  ["x", "Select the current queue row"],
  ["1 / 2 / 3", "Focus: log call, send text, snooze"],
  ["Space", "Focus: skip the current case"],
  ["u", "Focus: undo the last skip"],
] as const;

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return true;
  return element.isContentEditable;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<PaletteMode>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(event.target) || target?.closest('[role="dialog"], [role="alertdialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMode("commands");
        return;
      }
      if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setMode("shortcuts");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setQuery("");
    setActiveIndex(0);
  }, [mode]);

  const commands = useMemo(() => {
    const term = query.trim().toLowerCase();
    const searchCommands: Command[] = term
      ? [
          { label: `Search “${query.trim()}” in Collections`, hint: "Queue", href: `/dashboard?q=${encodeURIComponent(query.trim())}` },
          { label: `Search “${query.trim()}” in Accounts`, hint: "Directory", href: `/accounts?q=${encodeURIComponent(query.trim())}` },
          { label: `Search “${query.trim()}” in Messages`, hint: "Inbox", href: `/messages?q=${encodeURIComponent(query.trim())}` },
        ]
      : [];
    const filtered = NAV_COMMANDS.filter((command) =>
      !term || `${command.label} ${command.hint}`.toLowerCase().includes(term),
    );
    return [...searchCommands, ...filtered];
  }, [query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  function choose(command: Command) {
    setMode(null);
    if (command.href.startsWith("mailto:")) {
      window.location.assign(command.href);
      return;
    }
    navigate(command.href);
  }

  function onCommandKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, commands.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) choose(command);
    }
  }

  return (
    <>
      {mode === "commands" ? (
        <ModalShell label="Command palette" onClose={() => setMode(null)} maxWidth="max-w-xl" className="p-0">
          <div className="border-b border-border p-3">
            <label className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 h-10 focus-within:ring-2 focus-within:ring-copper">
              <Icon name="search" size={16} className="text-muted" />
              <span className="sr-only">Search commands</span>
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onCommandKeyDown}
                placeholder="Search pages and actions…"
                className="h-8 flex-1 border-0 bg-transparent px-0 focus-visible:ring-0"
              />
              <Kbd>Esc</Kbd>
            </label>
          </div>
          <div className="max-h-[min(60vh,24rem)] overflow-y-auto p-2" role="listbox" aria-label="Commands">
            {commands.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">No matching commands.</p>
            ) : (
              commands.map((command, index) => (
                <button
                  key={`${command.href}-${command.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(command)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper ${
                    index === activeIndex ? "bg-copper/10 text-text" : "text-muted hover:bg-paper hover:text-text"
                  }`}
                >
                  <span>{command.label}</span>
                  <span className="text-xs text-muted">{command.hint}</span>
                </button>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted">
            <span>Navigate with arrows</span>
            <span><Kbd>Enter</Kbd> open</span>
          </div>
        </ModalShell>
      ) : null}
      {mode === "shortcuts" ? (
        <ModalShell label="Keyboard shortcuts" onClose={() => setMode(null)} maxWidth="max-w-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-text">Keyboard shortcuts</h2>
              <p className="mt-1 text-xs text-muted">Shortcuts pause while you type or work inside a dialog.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close shortcuts" onClick={() => setMode(null)}>×</Button>
          </div>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {SHORTCUTS.map(([key, description]) => (
              <div key={key} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="text-text">{description}</span>
                <Kbd className="shrink-0">{key}</Kbd>
              </div>
            ))}
          </div>
          <p className="mt-3 text-right text-xs text-muted">Current page: {location.pathname}</p>
        </ModalShell>
      ) : null}
    </>
  );
}
