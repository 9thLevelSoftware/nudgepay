import { describe, it, expect } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../app/lib/unsubscribe-token";

const SECRET = "test-secret";
describe("unsubscribe token", () => {
  it("round-trips org+customer", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken(SECRET, t)).toEqual({ orgId: "org-1", customerId: "cust-1" });
  });
  it("rejects a tampered token", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken(SECRET, t + "x")).toBeNull();
  });
  it("rejects a wrong secret", async () => {
    const t = await signUnsubscribeToken(SECRET, "org-1", "cust-1");
    expect(await verifyUnsubscribeToken("other", t)).toBeNull();
  });
  it("returns null on malformed input", async () => {
    expect(await verifyUnsubscribeToken(SECRET, "garbage")).toBeNull();
  });
});
