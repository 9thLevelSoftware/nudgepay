import { describe, expect, it } from "vitest";
import {
  billingBlocksWorkspaceDeletion,
  workspaceDeletionDecision,
  workspaceDeletionQboPlan,
  workspaceDeletionRpcError,
} from "../app/lib/workspace-deletion";

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

describe("workspace deletion provider guards", () => {
  it("blocks every non-canceled subscription state and permits retired billing", () => {
    for (const status of ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"]) {
      expect(billingBlocksWorkspaceDeletion({ status })).toBe(true);
    }
    expect(billingBlocksWorkspaceDeletion({
      status: "none",
      stripe_subscription_id: "sub_unreconciled",
    })).toBe(true);
    expect(billingBlocksWorkspaceDeletion({
      status: "canceled",
      stripe_subscription_id: "sub_retired",
    })).toBe(false);
    expect(billingBlocksWorkspaceDeletion({
      status: "incomplete_expired",
      stripe_subscription_id: "sub_expired",
    })).toBe(false);
    expect(billingBlocksWorkspaceDeletion({ status: "none" })).toBe(false);
  });

  it("maps database conflicts to actionable Settings errors", () => {
    expect(workspaceDeletionRpcError({
      code: "PT409",
      message: "workspace deletion blocked by billing subscription",
    })).toBe("billing");
    expect(workspaceDeletionRpcError({
      code: "PT409",
      message: "workspace deletion blocked by pending provider work",
    })).toBe("pending");
    expect(workspaceDeletionRpcError({ code: "PT409", message: "another conflict" }))
      .toBe("workspace");
    expect(workspaceDeletionRpcError({ code: "P0001", message: "not an owner" }))
      .toBe("workspace");
  });

  it("requires a configured revoke path whenever QuickBooks tokens remain", () => {
    expect(workspaceDeletionQboPlan({
      hasAccessToken: false,
      hasRefreshToken: false,
      configured: false,
    })).toBe("none");
    expect(workspaceDeletionQboPlan({
      hasAccessToken: true,
      hasRefreshToken: true,
      configured: false,
    })).toBe("blocked");
    expect(workspaceDeletionQboPlan({
      hasAccessToken: true,
      hasRefreshToken: false,
      configured: true,
    })).toBe("blocked");
    expect(workspaceDeletionQboPlan({
      hasAccessToken: true,
      hasRefreshToken: true,
      configured: true,
    })).toBe("disconnect");
  });
});
