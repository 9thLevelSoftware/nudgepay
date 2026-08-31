// Pure DSAR access payload. No I/O — the route loads rows, then this helper
// shapes the JSON the subject can download.

export type PersonalDataExport = {
  exportedAt: string;
  truncated: boolean;
  account: {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string | null;
  };
  membership: {
    orgId: string;
    orgName: string;
    role: string;
  } | null;
  notificationPrefs: {
    brokenPromiseEmail: boolean;
    dailyDigestEmail: boolean;
  } | null;
  contactLogs: Array<{
    id: string;
    createdAt: string;
    method: string;
    outcome: string | null;
  }>;
};

export function buildPersonalDataExport(input: {
  exportedAt: string;
  truncated: boolean;
  account: PersonalDataExport["account"];
  membership: PersonalDataExport["membership"];
  notificationPrefs: PersonalDataExport["notificationPrefs"];
  contactLogs: PersonalDataExport["contactLogs"];
}): PersonalDataExport {
  return {
    exportedAt: input.exportedAt,
    truncated: input.truncated,
    account: input.account,
    membership: input.membership,
    notificationPrefs: input.notificationPrefs,
    contactLogs: input.contactLogs,
  };
}

export function personalExportFilename(exportedAt: string): string {
  const day = exportedAt.slice(0, 10) || "account";
  return `nudgepay-account-${day}.json`;
}
