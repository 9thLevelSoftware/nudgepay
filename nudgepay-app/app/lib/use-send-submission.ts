import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  deriveInitialSubmissionId,
  isSendSubmissionId,
  readPendingSubmission,
  selectSubmissionForAttempt,
  shouldRotateAfterSuccess,
  submissionPayloadKey,
  submissionStorageKey,
  writePendingSubmission,
  type PendingSubmission,
  type SubmissionStorage,
} from "./send-submission";

type SendResult = { id: string | null; success: boolean } | null;

const STORAGE_ERROR = "Sending needs browser session storage. Enable it, then reload this page.";

function verifiedStorage(key: string): SubmissionStorage | null {
  try {
    const storage = window.sessionStorage;
    const probeKey = `${key}:probe`;
    const previous = storage.getItem(probeKey);
    const probe = `${Date.now()}:${Math.random()}`;
    storage.setItem(probeKey, probe);
    if (storage.getItem(probeKey) !== probe) return null;
    if (previous === null) storage.removeItem(probeKey);
    else storage.setItem(probeKey, previous);
    return storage;
  } catch {
    return null;
  }
}

function persisted(storage: SubmissionStorage, key: string, value: PendingSubmission): boolean {
  if (!writePendingSubmission(storage, key, value)) return false;
  const readBack = readPendingSubmission(storage, key);
  return readBack?.id === value.id && readBack.payloadKey === value.payloadKey;
}

export function useSendSubmission(args: {
  serverSeed: string;
  userId: string;
  orgId: string;
  channel: "sms" | "email" | "sms-bulk";
  customerId: string;
  result: SendResult;
}) {
  const scope = `${args.userId}:${args.orgId}:${args.channel}:${args.customerId}`;
  const storageKey = submissionStorageKey(args);
  const serverInitialId = useMemo(
    () => deriveInitialSubmissionId(args.serverSeed, scope),
    [args.serverSeed, scope],
  );
  const retryId = args.result && !args.result.success && isSendSubmissionId(args.result.id)
    ? args.result.id
    : null;
  const renderedInitialId = retryId ?? serverInitialId;
  const [submissionId, setSubmissionId] = useState(renderedInitialId);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(submissionId);
  const idScopeRef = useRef(storageKey);
  const pendingRef = useRef<PendingSubmission | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    idRef.current = submissionId;
  }, [submissionId]);

  useEffect(() => {
    const storage = verifiedStorage(storageKey);
    if (!storage) {
      setReady(false);
      setError(STORAGE_ERROR);
      return;
    }
    const inMemory = idScopeRef.current === storageKey ? pendingRef.current : null;
    const stored = inMemory ?? readPendingSubmission(storage, storageKey);
    if (args.result?.success) {
      const currentMatches = shouldRotateAfterSuccess({
        currentId: idRef.current,
        currentScopeMatches: idScopeRef.current === storageKey,
        resultId: args.result.id,
      });
      const storedMatches = stored !== null && shouldRotateAfterSuccess({
        currentId: stored.id,
        currentScopeMatches: true,
        resultId: args.result.id,
      });
      if (currentMatches || storedMatches) {
        const next = crypto.randomUUID();
        const fresh = { id: next, payloadKey: null };
        if (!persisted(storage, storageKey, fresh)) {
          setReady(false);
          setError(STORAGE_ERROR);
          return;
        }
        idRef.current = next;
        idScopeRef.current = storageKey;
        pendingRef.current = fresh;
        setSubmissionId(next);
      } else {
        const next = stored?.id ?? serverInitialId;
        idRef.current = next;
        idScopeRef.current = storageKey;
        pendingRef.current = stored;
        setSubmissionId(next);
      }
      setReady(true);
      setError(null);
      return;
    }

    const next = stored?.id ?? renderedInitialId;
    idRef.current = next;
    idScopeRef.current = storageKey;
    pendingRef.current = stored;
    setSubmissionId(next);
    setReady(true);
    setError(null);
  }, [args.result?.id, args.result?.success, renderedInitialId, serverInitialId, storageKey]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    if (event.defaultPrevented) return;
    if (!ready) {
      event.preventDefault();
      setError(STORAGE_ERROR);
      return;
    }
    const storage = verifiedStorage(storageKey);
    if (!storage) {
      event.preventDefault();
      setReady(false);
      setError(STORAGE_ERROR);
      return;
    }
    const form = event.currentTarget;
    const payloadKey = submissionPayloadKey(new FormData(form));
    const stored = (idScopeRef.current === storageKey ? pendingRef.current : null)
      ?? readPendingSubmission(storage, storageKey);
    const selected = selectSubmissionForAttempt({
      currentId: idRef.current,
      currentScopeMatches: idScopeRef.current === storageKey,
      serverInitialId,
      stored,
      payloadKey,
      newId: crypto.randomUUID(),
    });
    const pending = { id: selected, payloadKey };
    if (!persisted(storage, storageKey, pending)) {
      event.preventDefault();
      setReady(false);
      setError(STORAGE_ERROR);
      return;
    }
    idRef.current = selected;
    idScopeRef.current = storageKey;
    if (inputRef.current) inputRef.current.value = selected;
    setSubmissionId(selected);
    pendingRef.current = pending;
    setError(null);
  }

  return { submissionId, inputRef, onSubmit, ready, error };
}
