// Pure promise classification. No I/O, no .server. Balance-delta model:
// received = max(0, baseline - current linked balance). Only `pending` promises
// are evaluated; all other statuses are terminal and return null (no change).

export type PromiseStatus =
  | "pending" | "kept" | "partially_kept" | "broken" | "renegotiated" | "cancelled";

export type PromiseEvalRow = {
  id: string;
  status: PromiseStatus;
  promisedAmount: number;
  baselineBalance: number;
  graceUntil: string; // YYYY-MM-DD
};

export type PromiseEvalOp = {
  promiseId: string;
  status: PromiseStatus;   // kept | partially_kept | broken
  amountReceived: number;
  resolvedAt: string;      // `today` — all returned statuses are terminal
};

export function evaluatePromise(
  row: PromiseEvalRow, currentLinkedBalance: number, today: string,
): PromiseEvalOp | null {
  if (row.status !== "pending") return null;
  const received = Math.max(0, row.baselineBalance - currentLinkedBalance);

  if (received >= row.promisedAmount) {
    return { promiseId: row.id, status: "kept", amountReceived: received, resolvedAt: today };
  }
  if (today > row.graceUntil) {
    const status = received > 0 ? "partially_kept" : "broken";
    return { promiseId: row.id, status, amountReceived: received, resolvedAt: today };
  }
  return null; // before grace, not fully received — stay pending
}

export function evaluatePromises(
  rows: PromiseEvalRow[], balanceByPromiseId: Map<string, number>, today: string,
): PromiseEvalOp[] {
  const ops: PromiseEvalOp[] = [];
  for (const row of rows) {
    const balance = balanceByPromiseId.get(row.id) ?? row.baselineBalance;
    const op = evaluatePromise(row, balance, today);
    if (op) ops.push(op);
  }
  return ops;
}
