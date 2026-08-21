// Pure CSV for the collections work queue. No I/O.

export type QueueCsvRow = {
  customerName: string;
  status: string;
  totalOverdue: number;
  oldestAgeDays: number;
  invoiceCount: number;
  lastContactDate: string | null;
  lastContactChannel: string | null;
  owner: string;
};

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const COLUMNS = [
  "customer", "status", "total_overdue", "oldest_age_days",
  "invoice_count", "last_contact_date", "last_contact_channel", "owner",
] as const;

export function queueItemsToCsv(rows: QueueCsvRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([
      csvField(r.customerName),
      csvField(r.status),
      String(r.totalOverdue),
      String(r.oldestAgeDays),
      String(r.invoiceCount),
      csvField(r.lastContactDate ?? ""),
      csvField(r.lastContactChannel ?? ""),
      csvField(r.owner),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
