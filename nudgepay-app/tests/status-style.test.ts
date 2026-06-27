import { describe, it, expect } from "vitest";
import { statusChipTone } from "../app/lib/status-style";

describe("statusChipTone", () => {
  it("maps promised to cool", () => {
    expect(statusChipTone("promised")).toBe("cool");
  });
  it("maps new and working to copper", () => {
    expect(statusChipTone("new")).toBe("copper");
    expect(statusChipTone("working")).toBe("copper");
  });
  it("maps waiting, on_hold, resolved to neutral", () => {
    expect(statusChipTone("waiting")).toBe("neutral");
    expect(statusChipTone("on_hold")).toBe("neutral");
    expect(statusChipTone("resolved")).toBe("neutral");
  });
  it("falls back to neutral for an unknown status", () => {
    expect(statusChipTone("something-else")).toBe("neutral");
  });
});
