import { describe, expect, it } from "vitest";
import {
  classifyInboundSms,
  ensureStopLanguage,
  hasStopLanguage,
  STOP_LANGUAGE,
  twimlForKeyword,
} from "../app/lib/sms-keywords";

describe("classifyInboundSms", () => {
  it("matches exact STOP family", () => {
    expect(classifyInboundSms("STOP")).toBe("stop");
    expect(classifyInboundSms("stopall")).toBe("stop");
    expect(classifyInboundSms("  CANCEL  ")).toBe("stop");
  });
  it("matches STOP as the first word", () => {
    expect(classifyInboundSms("STOP please")).toBe("stop");
  });
  it("matches START and HELP", () => {
    expect(classifyInboundSms("YES")).toBe("start");
    expect(classifyInboundSms("HELP")).toBe("help");
    expect(classifyInboundSms("INFO")).toBe("help");
  });
  it("returns null for ordinary replies", () => {
    expect(classifyInboundSms("I'll pay Friday")).toBeNull();
    expect(classifyInboundSms("")).toBeNull();
  });
});

describe("ensureStopLanguage", () => {
  it("appends when missing", () => {
    expect(ensureStopLanguage("Hi {customer}")).toBe(`Hi {customer} ${STOP_LANGUAGE}`);
  });
  it("does not duplicate", () => {
    const already = `Please pay. ${STOP_LANGUAGE}`;
    expect(ensureStopLanguage(already)).toBe(already);
    expect(hasStopLanguage(already)).toBe(true);
  });
});

describe("twimlForKeyword", () => {
  it("confirms opt-out", () => {
    expect(twimlForKeyword("stop", "Acme")).toContain("unsubscribed");
  });
  it("returns HELP with org name", () => {
    expect(twimlForKeyword("help", "Acme Co")).toContain("Acme Co");
    expect(twimlForKeyword("help", "Acme Co")).toContain("STOP");
  });
  it("returns null for ordinary inbound", () => {
    expect(twimlForKeyword(null, "Acme")).toBeNull();
  });
});
