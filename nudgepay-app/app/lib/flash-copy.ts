// Pure copy for query-param flash banners.

export const QBO_FLASH: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  connected: { tone: "ok", text: "QuickBooks connected. Overdue invoices will appear after the first sync." },
  disconnected: { tone: "ok", text: "QuickBooks disconnected." },
  error: { tone: "err", text: "Could not connect QuickBooks. Try again from Settings → Integrations." },
  forbidden: { tone: "err", text: "Only workspace owners can connect or disconnect QuickBooks." },
  unconfigured: { tone: "warn", text: "QuickBooks isn't configured on this server yet. An operator needs to set the QBO Worker secrets." },
  sync_error: { tone: "warn", text: "QuickBooks connected, but the first sync hit an error. Check Settings → Integrations." },
};

export const SYNC_FLASH: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  ok: { tone: "ok", text: "Sync finished." },
  error: { tone: "err", text: "Sync failed. See Settings → Integrations for details." },
};
