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
