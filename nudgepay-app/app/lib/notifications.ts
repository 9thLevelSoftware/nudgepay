// Pure email-content builders for team alert emails (broken-promise immediate
// + daily follow-ups-due digest). No I/O, no .server suffix. The actual
// sending is in notifications.server.ts.

import { formatUSD } from "./format";

// ---------------------------------------------------------------------------
// Broken-promise immediate email
// ---------------------------------------------------------------------------

export type BrokenPromiseEmailInput = {
  customerName: string;
  promisedAmount: number;
  promisedDate: string;
  appUrl: string;
};

export function brokenPromiseEmail(input: BrokenPromiseEmailInput): { subject: string; html: string } {
  const { customerName, promisedAmount, promisedDate, appUrl } = input;
  const subject = `Broken promise: ${customerName} — ${formatUSD(promisedAmount)}`;
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a; font-size: 18px; margin: 0 0 16px;">Broken Promise</h2>
  <p style="color: #333; font-size: 14px; line-height: 1.5; margin: 0 0 12px;">
    <strong>${escapeHtml(customerName)}</strong> did not follow through on their payment promise.
  </p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
    <tr>
      <td style="padding: 8px 12px; background: #f5f5f4; color: #666; border-radius: 4px 0 0 0;">Promised amount</td>
      <td style="padding: 8px 12px; background: #f5f5f4; text-align: right; border-radius: 0 4px 0 0;"><strong>${formatUSD(promisedAmount)}</strong></td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; color: #666;">Promised by</td>
      <td style="padding: 8px 12px; text-align: right;">${escapeHtml(promisedDate)}</td>
    </tr>
  </table>
  <p style="color: #333; font-size: 14px; line-height: 1.5; margin: 16px 0 8px;">
    The case has been moved back to <strong>Working</strong> status with a follow-up scheduled for today.
  </p>
  <p style="margin: 20px 0;">
    <a href="${escapeHtml(appUrl)}/dashboard?view=broken-promises"
       style="display: inline-block; background: #b45309; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
      View broken promises
    </a>
  </p>
  <p style="color: #999; font-size: 12px; margin-top: 24px;">
    Manage alert preferences in Settings → Notifications.
  </p>
</div>`.trim();
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Daily follow-ups-due digest
// ---------------------------------------------------------------------------

export type DigestCaseLine = {
  customerName: string;
  totalOverdue: number;
  nextActionAt: string | null;
};

export type DigestEmailInput = {
  recipientName: string;
  assignedCases: DigestCaseLine[];
  unassignedCases: DigestCaseLine[];
  appUrl: string;
  today: string;
};

export function digestEmail(input: DigestEmailInput): { subject: string; html: string } {
  const { recipientName, assignedCases, unassignedCases, appUrl, today } = input;
  const totalCount = assignedCases.length + unassignedCases.length;
  const subject = `Follow-ups due today (${totalCount} account${totalCount === 1 ? "" : "s"})`;

  const renderLines = (cases: DigestCaseLine[]): string =>
    cases.map((c) =>
      `<tr>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 14px;">${escapeHtml(c.customerName)}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 14px; text-align: right;">${formatUSD(c.totalOverdue)}</td>
      </tr>`
    ).join("");

  let body = "";

  if (assignedCases.length > 0) {
    body += `
    <h3 style="color: #333; font-size: 15px; margin: 16px 0 8px;">Your accounts (${assignedCases.length})</h3>
    <table style="width: 100%; border-collapse: collapse;">${renderLines(assignedCases)}</table>`;
  }

  if (unassignedCases.length > 0) {
    body += `
    <h3 style="color: #333; font-size: 15px; margin: 16px 0 8px;">Unassigned accounts (${unassignedCases.length})</h3>
    <table style="width: 100%; border-collapse: collapse;">${renderLines(unassignedCases)}</table>`;
  }

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a; font-size: 18px; margin: 0 0 4px;">Daily Follow-Up Digest</h2>
  <p style="color: #666; font-size: 13px; margin: 0 0 16px;">${escapeHtml(today)}</p>
  <p style="color: #333; font-size: 14px; line-height: 1.5; margin: 0 0 12px;">
    Hi ${escapeHtml(recipientName)}, you have <strong>${totalCount}</strong> account${totalCount === 1 ? "" : "s"} with follow-ups due today.
  </p>
  ${body}
  <p style="margin: 20px 0;">
    <a href="${escapeHtml(appUrl)}/dashboard?view=follow-ups-due"
       style="display: inline-block; background: #b45309; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
      View follow-ups due
    </a>
  </p>
  <p style="color: #999; font-size: 12px; margin-top: 24px;">
    Manage alert preferences in Settings → Notifications.
  </p>
</div>`.trim();
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
