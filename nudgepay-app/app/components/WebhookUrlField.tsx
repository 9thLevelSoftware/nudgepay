import { useState } from "react";

export function WebhookUrlField({ label, url }: { label: string; url: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!url) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — field is still selectable */ }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-1">
        <input
          readOnly
          value={url}
          className="h-7 flex-1 rounded-md border border-border bg-panel px-2 text-xs text-text/80 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text hover:border-copper"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
