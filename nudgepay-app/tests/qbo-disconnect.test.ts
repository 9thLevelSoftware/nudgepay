import { expect, test } from "vitest";
import { orgNameMatches, qboDisconnectDecision } from "../app/lib/qbo-disconnect";

const ORG = "Acme HVAC";

test("exact org name matches", () => {
  expect(orgNameMatches("Acme HVAC", ORG)).toBe(true);
});

test("trimmed org name matches", () => {
  expect(orgNameMatches("  Acme HVAC  ", ORG)).toBe(true);
});

test("org name match is case-insensitive", () => {
  expect(orgNameMatches("acme hvac", ORG)).toBe(true);
  expect(orgNameMatches("ACME HVAC", ORG)).toBe(true);
});

test("empty confirm does not match and must not disconnect", () => {
  expect(orgNameMatches("", ORG)).toBe(false);
  expect(orgNameMatches("   ", ORG)).toBe(false);
  expect(orgNameMatches(null, ORG)).toBe(false);
  expect(orgNameMatches(undefined, ORG)).toBe(false);
  expect(qboDisconnectDecision("", ORG)).toEqual({ disconnect: false, qbo: "confirm" });
  expect(qboDisconnectDecision("   ", ORG)).toEqual({ disconnect: false, qbo: "confirm" });
  expect(qboDisconnectDecision(null, ORG)).toEqual({ disconnect: false, qbo: "confirm" });
});

test("wrong name does not match and must not disconnect", () => {
  expect(orgNameMatches("Other Co", ORG)).toBe(false);
  expect(orgNameMatches("Acme", ORG)).toBe(false);
  expect(orgNameMatches("Acme HVAC!", ORG)).toBe(false);
  expect(qboDisconnectDecision("Other Co", ORG)).toEqual({ disconnect: false, qbo: "confirm" });
  expect(qboDisconnectDecision("Acme", ORG)).toEqual({ disconnect: false, qbo: "confirm" });
});

test("matching name is the only path that disconnects", () => {
  expect(qboDisconnectDecision("Acme HVAC", ORG)).toEqual({ disconnect: true });
  expect(qboDisconnectDecision("  acme hvac  ", ORG)).toEqual({ disconnect: true });
});

test("blank stored org name never matches", () => {
  expect(orgNameMatches("", "")).toBe(false);
  expect(orgNameMatches("Acme HVAC", "")).toBe(false);
  expect(orgNameMatches("Acme HVAC", "   ")).toBe(false);
  expect(qboDisconnectDecision("Acme HVAC", "")).toEqual({ disconnect: false, qbo: "confirm" });
});
