import { describe, expect, it } from "vitest";
import { workspaceDeletionDecision } from "../app/lib/workspace-deletion";

const NAME = "Acme Collections";

describe("workspaceDeletionDecision", () => {
  it("rejects non-owners even with a matching name", () => {
    expect(workspaceDeletionDecision({
      isOwner: false,
      typedName: NAME,
      orgName: NAME,
    })).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects a mismatched or empty name", () => {
    expect(workspaceDeletionDecision({
      isOwner: true,
      typedName: "other",
      orgName: NAME,
    })).toEqual({ ok: false, error: "confirm" });
    expect(workspaceDeletionDecision({
      isOwner: true,
      typedName: "",
      orgName: NAME,
    })).toEqual({ ok: false, error: "confirm" });
  });

  it("allows an owner who types the workspace name", () => {
    expect(workspaceDeletionDecision({
      isOwner: true,
      typedName: "  acme collections  ",
      orgName: NAME,
    })).toEqual({ ok: true });
  });
});
