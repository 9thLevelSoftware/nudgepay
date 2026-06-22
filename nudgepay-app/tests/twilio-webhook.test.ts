import { expect, test } from "vitest";
import {
  twilioSignatureBase, signTwilioRequest, verifyTwilioSignature, parseTwilioForm,
} from "../app/lib/twilio-webhook.server";

const TOKEN = "test-auth-token";
const URL_ = "https://x.example/webhooks/twilio/inbound";

test("twilioSignatureBase appends params sorted by key as key+value after the url", () => {
  const base = twilioSignatureBase(URL_, { To: "+1", From: "+2", Body: "hi" });
  // sorted keys: Body, From, To
  expect(base).toBe(`${URL_}Bodyhi` + `From+2` + `To+1`);
});

test("verifyTwilioSignature accepts a signature the module itself produced", async () => {
  // Round-trip; the exact-algorithm-vs-Twilio match is confirmed in the live-trial doc.
  const params = { To: "+1", From: "+2", Body: "hi" };
  const sig = await signTwilioRequest(TOKEN, URL_, params);
  expect(await verifyTwilioSignature(TOKEN, URL_, params, sig)).toBe(true);
});

test("verifyTwilioSignature rejects tampered params, wrong token, and missing header", async () => {
  const params = { To: "+1", From: "+2", Body: "hi" };
  const sig = await signTwilioRequest(TOKEN, URL_, params);
  expect(await verifyTwilioSignature(TOKEN, URL_, { ...params, Body: "HI" }, sig)).toBe(false);
  expect(await verifyTwilioSignature("other", URL_, params, sig)).toBe(false);
  expect(await verifyTwilioSignature(TOKEN, URL_, params, null)).toBe(false);
});

test("parseTwilioForm decodes urlencoded body into a param map", () => {
  expect(parseTwilioForm("From=%2B12295550101&Body=Hello+there&MessageSid=SM9")).toEqual({
    From: "+12295550101", Body: "Hello there", MessageSid: "SM9",
  });
});
