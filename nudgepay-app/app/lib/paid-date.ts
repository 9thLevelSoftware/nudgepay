export type ExistingPaidRow = {
  qbo_id: string;
  balance: number;
  paid_date: string | null;
};

export function mergePaidDate(args: {
  existing: ExistingPaidRow | undefined; // undefined = insert
  incomingBalance: number;
  syncToday: string;
}): string | null {
  if (args.incomingBalance > 0) return null;                 // (1) reopened
  if (args.existing?.paid_date) return args.existing.paid_date; // (2) preserve
  if (!args.existing) return args.syncToday;                 // (3) insert newly paid
  if (args.existing.balance > 0) return args.syncToday;      // (3) first transition
  return null;                                               // (4) historically paid, untracked
}
