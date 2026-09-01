// Pure workspace-export gates and payload. No I/O — the route loads rows,
// then this helper shapes the JSON an owner can download.

export type WorkspaceExportTable<T> = { rows: T[]; truncated: boolean };

export type WorkspaceDataExport = {
  exportedAt: string;
  truncated: boolean;
  workspace: { id: string; name: string };
  memberships: WorkspaceExportTable<{ userId: string; role: string }>;
  customers: WorkspaceExportTable<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    erasedAt: string | null;
  }>;
  invoices: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    docNumber: string | null;
    amount: number | null;
    balance: number | null;
    dueDate: string | null;
    status: string | null;
  }>;
  cases: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    status: string | null;
    closedAt: string | null;
  }>;
  promises: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    caseId: string | null;
    status: string | null;
    promisedAmount: number | null;
    promisedDate: string | null;
    resolvedAt: string | null;
  }>;
  contactLogs: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    createdAt: string;
    method: string;
    outcome: string | null;
  }>;
  textMessages: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    createdAt: string;
    direction: string;
    body: string | null;
  }>;
  emailMessages: WorkspaceExportTable<{
    id: string;
    customerId: string | null;
    createdAt: string;
    direction: string;
    subject: string | null;
    body: string | null;
  }>;
};

export function workspaceExportAllowed(role: string): boolean {
  return role === "owner";
}

export function buildWorkspaceDataExport(input: WorkspaceDataExport): WorkspaceDataExport {
  return input;
}

export function workspaceExportFilename(exportedAt: string): string {
  const day = exportedAt.slice(0, 10) || "workspace";
  return `nudgepay-workspace-${day}.json`;
}
