import { expect, test } from "vitest";
import {
  ALREADY_IN_WORKSPACE,
  AlreadyInWorkspaceError,
  canJoinOrg,
  humanInviteError,
  isAlreadyInWorkspaceError,
} from "../app/lib/org-membership";

const ORG_A = "org-a";
const ORG_B = "org-b";

test("canJoinOrg allows joining when the user has no membership", () => {
  expect(canJoinOrg(null, ORG_A)).toBe("join");
  expect(canJoinOrg(undefined, ORG_A)).toBe("join");
  expect(canJoinOrg("", ORG_A)).toBe("join");
});

test("canJoinOrg treats the same org as already a member", () => {
  expect(canJoinOrg(ORG_A, ORG_A)).toBe("already_member");
});

test("canJoinOrg rejects a second, different org", () => {
  expect(canJoinOrg(ORG_A, ORG_B)).toBe("already_in_workspace");
});

test("canJoinOrg rejects creating an org when a membership already exists", () => {
  expect(canJoinOrg(ORG_A)).toBe("already_in_workspace");
  expect(canJoinOrg(ORG_A, null)).toBe("already_in_workspace");
});

test("canJoinOrg allows creating an org when the user has none", () => {
  expect(canJoinOrg(null)).toBe("join");
  expect(canJoinOrg(undefined, null)).toBe("join");
});

test("AlreadyInWorkspaceError carries the stable copy and code", () => {
  const err = new AlreadyInWorkspaceError();
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toBe(ALREADY_IN_WORKSPACE);
  expect(err.code).toBe("already_in_workspace");
  expect(isAlreadyInWorkspaceError(err)).toBe(true);
});

test("humanInviteError surfaces already-in-a-workspace instead of a raw message", () => {
  expect(humanInviteError(new AlreadyInWorkspaceError())).toBe(ALREADY_IN_WORKSPACE);
  expect(humanInviteError(new Error(ALREADY_IN_WORKSPACE))).toBe(ALREADY_IN_WORKSPACE);
});

test("humanInviteError maps known invite failures to clear copy", () => {
  expect(humanInviteError(new Error("Invite not found"))).toMatch(/invalid or has been removed/i);
  expect(humanInviteError(new Error("Invite expired"))).toMatch(/new invite link/i);
  expect(humanInviteError(new Error("Invite already accepted"))).toMatch(/already been used/i);
  expect(humanInviteError(new Error("This invite was sent to a different email address"))).toMatch(
    /different email address/i,
  );
});

test("humanInviteError does not leak raw database errors", () => {
  expect(humanInviteError(new Error('duplicate key value violates unique constraint "memberships_user_id_key"'))).toBe(
    "Could not accept that invite. Try again or ask for a new link.",
  );
  expect(humanInviteError("not-an-error")).toBe(
    "Could not accept that invite. Try again or ask for a new link.",
  );
});

