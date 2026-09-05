import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useSendSubmission } from "../app/lib/use-send-submission";
import {
  clearPendingSubmission,
  deriveInitialSubmissionId,
  deriveBulkSubmissionId,
  isSendSubmissionId,
  parsePendingSubmission,
  readPendingSubmission,
  requireSendSubmissionId,
  selectSubmissionForAttempt,
  shouldClearPendingAfterSuccess,
  shouldRotateAfterSuccess,
  submissionPayloadKey,
  submissionStorageKey,
  writePendingSubmission,
} from "../app/lib/send-submission";

const SEED = "018f0f4d-77c2-7a0a-9a73-4c44fb6c5912";
const NEXT = "018f0f4d-77c2-7a0a-9a73-4c44fb6c5913";

test("server seed derives stable, form-specific submission identities", () => {
  const sms = deriveInitialSubmissionId(SEED, "user-a:org-a:sms:customer-a");
  const retry = deriveInitialSubmissionId(SEED, "user-a:org-a:sms:customer-a");
  const email = deriveInitialSubmissionId(SEED, "user-a:org-a:email:customer-a");

  expect(retry).toBe(sms);
  expect(email).not.toBe(sms);
  expect(isSendSubmissionId(sms)).toBe(true);
});

test("bulk child identity is stable per case and cannot collide inside a batch", () => {
  const parent = deriveInitialSubmissionId(SEED, "user-a:org-a:sms-bulk:batch");
  expect(deriveBulkSubmissionId(parent, "11111111-1111-4111-8111-111111111111"))
    .toBe(deriveBulkSubmissionId(parent, "11111111-1111-4111-8111-111111111111"));
  expect(deriveBulkSubmissionId(parent, "11111111-1111-4111-8111-111111111111"))
    .not.toBe(deriveBulkSubmissionId(parent, "22222222-2222-4222-8222-222222222222"));
  expect(isSendSubmissionId(deriveBulkSubmissionId("x".repeat(128), "11111111-1111-4111-8111-111111111111")))
    .toBe(true);
});

test("pending storage is partitioned by user, workspace, channel, and customer", () => {
  const base = { userId: "user-a", orgId: "org-a", channel: "sms" as const, customerId: "customer-a" };
  expect(submissionStorageKey(base)).not.toBe(submissionStorageKey({ ...base, userId: "user-b" }));
  expect(submissionStorageKey(base)).not.toBe(submissionStorageKey({ ...base, orgId: "org-b" }));
  expect(submissionStorageKey(base)).not.toBe(submissionStorageKey({ ...base, channel: "email" }));
  expect(submissionStorageKey(base)).not.toBe(submissionStorageKey({ ...base, customerId: "customer-b" }));
});

test("unchanged retry reuses pending identity while changed payload is explicit new intent", () => {
  const pending = JSON.stringify({ id: SEED, payloadKey: "invoice=i1&body=hello" });
  expect(selectSubmissionForAttempt({
    currentId: NEXT,
    currentScopeMatches: true,
    serverInitialId: NEXT,
    stored: parsePendingSubmission(pending),
    payloadKey: "invoice=i1&body=hello",
    newId: "new-id",
  })).toBe(SEED);
  expect(selectSubmissionForAttempt({
    currentId: SEED,
    currentScopeMatches: true,
    serverInitialId: SEED,
    stored: parsePendingSubmission(pending),
    payloadKey: "invoice=i1&body=changed",
    newId: NEXT,
  })).toBe(NEXT);
  expect(selectSubmissionForAttempt({
    currentId: SEED,
    currentScopeMatches: true,
    serverInitialId: SEED,
    stored: { id: NEXT, payloadKey: null },
    payloadKey: "any first payload",
    newId: "new-id",
  })).toBe(NEXT);
});

test("payload tuple serialization cannot be confused by delimiter-like message text", () => {
  const embedded = new FormData();
  embedded.set("a", "x\nb=y");
  const separate = new FormData();
  separate.set("a", "x");
  separate.set("b", "y");
  expect(submissionPayloadKey(embedded)).not.toBe(submissionPayloadKey(separate));
});

test("stale success query cannot rotate a newer operation", () => {
  expect(shouldRotateAfterSuccess({ currentId: NEXT, currentScopeMatches: true, resultId: SEED })).toBe(false);
  expect(shouldRotateAfterSuccess({ currentId: SEED, currentScopeMatches: false, resultId: SEED })).toBe(false);
  expect(shouldRotateAfterSuccess({ currentId: SEED, currentScopeMatches: true, resultId: SEED })).toBe(true);
  expect(shouldClearPendingAfterSuccess({ storedId: SEED, resultId: SEED })).toBe(true);
  expect(shouldClearPendingAfterSuccess({ storedId: NEXT, resultId: SEED })).toBe(false);
});

test("malformed or oversized persisted identities are ignored", () => {
  expect(isSendSubmissionId("spaces are invalid")).toBe(false);
  expect(isSendSubmissionId("x".repeat(129))).toBe(false);
  expect(parsePendingSubmission("not json")).toBeNull();
  expect(parsePendingSubmission(JSON.stringify({ id: "bad id", payloadKey: "x" }))).toBeNull();
});

test("storage helpers report denial without throwing or inventing persistence", () => {
  const denied = {
    getItem(): string | null { throw new Error("denied"); },
    setItem(): void { throw new Error("denied"); },
    removeItem(): void { throw new Error("denied"); },
  };
  expect(readPendingSubmission(null, "key")).toBeNull();
  expect(readPendingSubmission(denied, "key")).toBeNull();
  expect(writePendingSubmission(denied, "key", { id: SEED, payloadKey: "payload" })).toBe(false);
  expect(clearPendingSubmission(denied, "key")).toBe(false);
});

test("send routes reject missing or malformed submission identities", () => {
  expect(() => requireSendSubmissionId(null)).toThrow(/identity required/i);
  expect(() => requireSendSubmissionId("bad identity")).toThrow(/identity required/i);
  expect(requireSendSubmissionId(SEED)).toBe(SEED);
});

test("server-safe send hook executes during SSR and disables sends before storage verification", () => {
  function ServerForm() {
    const submission = useSendSubmission({
      serverSeed: SEED,
      userId: "user-a",
      orgId: "org-a",
      channel: "sms",
      customerId: "customer-a",
      result: null,
    });
    return createElement("form", null,
      createElement("input", {
        ref: submission.inputRef,
        type: "hidden",
        name: "submissionId",
        value: submission.submissionId,
        readOnly: true,
      }),
      createElement("button", { type: "submit", disabled: !submission.ready }, "Send"),
    );
  }
  const html = renderToStaticMarkup(createElement(ServerForm));
  expect(html).toContain('name="submissionId"');
  expect(html).toContain("disabled");
});
