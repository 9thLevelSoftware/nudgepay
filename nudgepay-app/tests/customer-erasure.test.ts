import { describe, expect, it } from "vitest";
import { ERASED_CUSTOMER_NAME, customerErasureDecision } from "../app/lib/customer-erasure";

const NAME = "Acme Heating";

describe("customerErasureDecision", () => {
  it("rejects non-owners", () => {
    expect(customerErasureDecision({
      isOwner: false,
      alreadyErased: false,
      typedName: NAME,
      customerName: NAME,
    })).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects a second erase", () => {
    expect(customerErasureDecision({
      isOwner: true,
      alreadyErased: true,
      typedName: NAME,
      customerName: NAME,
    })).toEqual({ ok: false, error: "already" });
  });

  it("rejects a mismatched name", () => {
    expect(customerErasureDecision({
      isOwner: true,
      alreadyErased: false,
      typedName: "other",
      customerName: NAME,
    })).toEqual({ ok: false, error: "confirm" });
  });

  it("allows an owner who types the customer name", () => {
    expect(customerErasureDecision({
      isOwner: true,
      alreadyErased: false,
      typedName: "  acme heating  ",
      customerName: NAME,
    })).toEqual({ ok: true });
  });
});

describe("ERASED_CUSTOMER_NAME", () => {
  it("is the display label after erasure", () => {
    expect(ERASED_CUSTOMER_NAME).toBe("Erased customer");
  });
});
