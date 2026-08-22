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
  entity?: string;
  docNumber?: string | null;
  payerBand?: string | null;
  daysToPay?: number | null;
  replyRate?: number | null;
};

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const COLUMNS = [
  "customer", "status", "total_overdue", "oldest_age_days",
  "invoice_count", "last_contact_date", "last_contact_channel", "owner",
  "entity", "doc_number", "payer_band", "days_to_pay", "reply_rate",
] as const;

function csvNum(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

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
      csvField(r.entity ?? ""),
      csvField(r.docNumber ?? ""),
      csvField(r.payerBand ?? ""),
      csvNum(r.daysToPay),
      csvNum(r.replyRate),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
