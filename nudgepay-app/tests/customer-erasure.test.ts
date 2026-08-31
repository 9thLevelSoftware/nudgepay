import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("matches the SQL literal in 0055 so UI and RPC cannot drift", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../supabase/migrations/0055_erase_customer_pii.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toContain(`set name = '${ERASED_CUSTOMER_NAME}'`);
  });
});
