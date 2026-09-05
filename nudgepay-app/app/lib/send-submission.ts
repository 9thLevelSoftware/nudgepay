export const SEND_SUBMISSION_FIELD = "submissionId";
export const SEND_SUBMISSION_RESULT_FIELD = "sendSubmission";

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export type PendingSubmission = { id: string; payloadKey: string | null };
export type SubmissionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

import { fnv1a64Hex } from "./hash";
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function isSendSubmissionId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

export function requireSendSubmissionId(value: FormDataEntryValue | null): string {
  if (!isSendSubmissionId(value)) throw new Error("Valid send submission identity required");
  return value;
}

/** One server-issued document seed produces distinct, hydration-stable form identities. */
export function deriveInitialSubmissionId(seed: string, scope: string): string {
  if (!isSendSubmissionId(seed)) throw new Error("Valid send submission seed required");
  return `${seed}.${fnv1a64Hex(scope)}`;
}

/** A bulk retry must address each case with the same child identity. */
export function deriveBulkSubmissionId(parentId: string, caseId: string): string {
  if (!isSendSubmissionId(parentId) || !isSendSubmissionId(caseId)) {
    throw new Error("Valid bulk send submission identity required");
  }
  return `bulk:${fnv1a64Hex(parentId)}:${fnv1a64Hex(caseId)}`;
}

export function submissionStorageKey(args: {
  userId: string;
  orgId: string;
  channel: "sms" | "email" | "sms-bulk";
  customerId: string;
}): string {
  return `nudgepay-send:${args.userId}:${args.orgId}:${args.channel}:${args.customerId}`;
}

export function parsePendingSubmission(raw: string | null): PendingSubmission | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; payloadKey?: unknown };
    if (
      !isSendSubmissionId(value.id)
      || (value.payloadKey !== null && typeof value.payloadKey !== "string")
      || (typeof value.payloadKey === "string" && value.payloadKey.length > 128)
    ) {
      return null;
    }
    return { id: value.id, payloadKey: value.payloadKey };
  } catch {
    return null;
  }
}

export function readPendingSubmission(storage: SubmissionStorage | null, key: string): PendingSubmission | null {
  if (!storage) return null;
  try {
    return parsePendingSubmission(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writePendingSubmission(
  storage: SubmissionStorage | null,
  key: string,
  pending: PendingSubmission,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSubmission(storage: SubmissionStorage | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function submissionPayloadKey(form: FormData): string {
  const entries = [...form.entries()]
    .filter(([key]) => ![SEND_SUBMISSION_FIELD, "returnTo", "respond"].includes(key))
    .map(([key, value]): [string, string] => [key, typeof value === "string" ? value : value.name])
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  return fnv1a64Hex(JSON.stringify(entries));
}

export function selectSubmissionForAttempt(args: {
  currentId: string;
  currentScopeMatches: boolean;
  serverInitialId: string;
  stored: PendingSubmission | null;
  payloadKey: string;
  newId: string;
}): string {
  if (args.stored) {
    return args.stored.payloadKey === null || args.stored.payloadKey === args.payloadKey
      ? args.stored.id
      : args.newId;
  }
  return args.currentScopeMatches ? args.currentId : args.serverInitialId;
}

export function shouldRotateAfterSuccess(args: {
  currentId: string;
  currentScopeMatches: boolean;
  resultId: string | null;
}): boolean {
  return args.currentScopeMatches && args.resultId !== null && args.currentId === args.resultId;
}

export function shouldClearPendingAfterSuccess(args: { storedId: string | null; resultId: string | null }): boolean {
  return args.resultId !== null && args.storedId === args.resultId;
}
