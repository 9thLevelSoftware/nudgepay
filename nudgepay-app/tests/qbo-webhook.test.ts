import { expect, test } from "vitest";
import {
  signQboPayload, verifyQboSignature, parseQboWebhook,
} from "../app/lib/qbo-webhook.server";

const TOKEN = "test-verifier-token";

test("verifyQboSignature accepts a signature the module itself produced", async () => {
  // Round-trip: HMAC-SHA256(token, body) base64 == intuit-signature header.
  // (The exact algorithm vs Intuit is confirmed in the live-sandbox doc.)
  const body = JSON.stringify({ eventNotifications: [] });
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body, sig, TOKEN)).toBe(true);
});

test("verifyQboSignature rejects a tampered body", async () => {
  const body = JSON.stringify({ eventNotifications: [{ realmId: "1" }] });
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body + "x", sig, TOKEN)).toBe(false);
});

test("verifyQboSignature rejects the wrong token", async () => {
  const body = "payload";
  const sig = await signQboPayload(body, TOKEN);
  expect(await verifyQboSignature(body, sig, "other-token")).toBe(false);
});

test("verifyQboSignature rejects a missing header", async () => {
  expect(await verifyQboSignature("body", null, TOKEN)).toBe(false);
});

test("parseQboWebhook flattens entities across event notifications", () => {
  const body = JSON.stringify({
    eventNotifications: [
      { realmId: "9130", dataChangeEvent: { entities: [
        { name: "Invoice", id: "100", operation: "Update" },
        { name: "Customer", id: "5", operation: "Create" },
      ] } },
      { realmId: "9131", dataChangeEvent: { entities: [
        { name: "Invoice", id: "200", operation: "Delete" },
      ] } },
    ],
  });
  const out = parseQboWebhook(body);
  expect(out).toEqual([
    { realmId: "9130", entityName: "Invoice", id: "100", operation: "Update" },
    { realmId: "9130", entityName: "Customer", id: "5", operation: "Create" },
    { realmId: "9131", entityName: "Invoice", id: "200", operation: "Delete" },
  ]);
});

test("parseQboWebhook returns [] for malformed JSON", () => {
  expect(parseQboWebhook("{not json")).toEqual([]);
});

test("parses CloudEvents payload (array of qbo.<entity>.<event>.v1)", () => {
  const body = JSON.stringify([
    { type: "qbo.creditmemo.create.v1", intuitentityid: "777", intuitaccountid: "RID2" },
    { type: "qbo.invoice.update.v1", intuitentityid: "42", intuitaccountid: "RID2" },
  ]);
  expect(parseQboWebhook(body)).toEqual([
    { realmId: "RID2", entityName: "CreditMemo", id: "777", operation: "create" },
    { realmId: "RID2", entityName: "Invoice", id: "42", operation: "update" },
  ]);
});

// Locked production shape: Intuit CloudEvents v1.0 as documented (Nov 2025
// sample / SampleApp-Webhooks-Java-Cloudevents). Keys and casing are the
// official payload; entity/event tokens are ones this app consumes.
const INTUIT_CLOUDEVENTS_FIXTURE = Object.freeze([
  Object.freeze({
    specversion: "1.0",
    id: "88cd52aa-33b6-4351-9aa4-47572edbd068",
    source: "intuit.dsnBgbseACLLRZNxo2dfc4evmEJdxde58xeeYcZliOU=",
    type: "qbo.invoice.updated.v1",
    datacontenttype: "application/json",
    time: "2025-09-10T21:31:25.179851517Z",
    intuitentityid: "42",
    intuitaccountid: "310687",
    data: Object.freeze({}),
  }),
  Object.freeze({
    specversion: "1.0",
    id: "a1b2c3d4-33b6-4351-9aa4-47572edbd069",
    source: "intuit.dsnBgbseACLLRZNxo2dfc4evmEJdxde58xeeYcZliOU=",
    type: "qbo.customer.created.v1",
    datacontenttype: "application/json",
    time: "2025-09-10T21:31:25.179851517Z",
    intuitentityid: "1234",
    intuitaccountid: "310687",
    data: Object.freeze({}),
  }),
  Object.freeze({
    specversion: "1.0",
    id: "b2c3d4e5-33b6-4351-9aa4-47572edbd070",
    source: "intuit.dsnBgbseACLLRZNxo2dfc4evmEJdxde58xeeYcZliOU=",
    type: "qbo.payment.deleted.v1",
    datacontenttype: "application/json",
    time: "2025-09-10T21:31:25.179851517Z",
    intuitentityid: "501",
    intuitaccountid: "310687",
    data: Object.freeze({}),
  }),
  Object.freeze({
    specversion: "1.0",
    id: "c3d4e5f6-33b6-4351-9aa4-47572edbd071",
    source: "intuit.dsnBgbseACLLRZNxo2dfc4evmEJdxde58xeeYcZliOU=",
    type: "qbo.credit_memo.updated.v1",
    datacontenttype: "application/json",
    time: "2025-09-10T21:31:25.179851517Z",
    intuitentityid: "777",
    intuitaccountid: "310687",
    data: Object.freeze({}),
  }),
]);

test("parses the locked Intuit CloudEvents production fixture", () => {
  expect(parseQboWebhook(JSON.stringify(INTUIT_CLOUDEVENTS_FIXTURE))).toEqual([
    { realmId: "310687", entityName: "Invoice", id: "42", operation: "updated" },
    { realmId: "310687", entityName: "Customer", id: "1234", operation: "created" },
    { realmId: "310687", entityName: "Payment", id: "501", operation: "deleted" },
    { realmId: "310687", entityName: "CreditMemo", id: "777", operation: "updated" },
  ]);
});

test("CloudEvents parser ignores undocumented entity types in the Intuit envelope", () => {
  const body = JSON.stringify([{
    specversion: "1.0",
    id: "88cd52aa-33b6-4351-9aa4-47572edbd068",
    source: "intuit.dsnBgbseACLLRZNxo2dfc4evmEJdxde58xeeYcZliOU=",
    type: "qbo.account.created.v1",
    datacontenttype: "application/json",
    time: "2025-09-10T21:31:25.179851517Z",
    intuitentityid: "1234",
    intuitaccountid: "310687",
    data: {},
  }]);
  expect(parseQboWebhook(body)).toEqual([]);
});

test("parseQboWebhook still flattens legacy eventNotifications next to CloudEvents", () => {
  const legacy = {
    eventNotifications: [
      { realmId: "9130", dataChangeEvent: { entities: [
        { name: "Invoice", id: "100", operation: "Update" },
      ] } },
    ],
  };
  expect(parseQboWebhook(JSON.stringify(legacy))).toEqual([
    { realmId: "9130", entityName: "Invoice", id: "100", operation: "Update" },
  ]);
});
