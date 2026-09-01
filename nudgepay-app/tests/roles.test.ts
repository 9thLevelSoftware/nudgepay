import { expect, test } from "vitest";
import {
  assignableRoles,
  hasPermission,
  isAdminRole,
  isOwnerRole,
  parseRole,
} from "../app/lib/roles";

test("parseRole accepts owner, admin, and member", () => {
  expect(parseRole("owner")).toBe("owner");
  expect(parseRole("admin")).toBe("admin");
  expect(parseRole("member")).toBe("member");
  expect(parseRole("Owner")).toBeNull();
  expect(parseRole("")).toBeNull();
  expect(parseRole(null)).toBeNull();
});

test("owner has every permission", () => {
  expect(isOwnerRole("owner")).toBe(true);
  expect(isAdminRole("owner")).toBe(true);
  expect(hasPermission("owner", "manageWorkspace")).toBe(true);
  expect(hasPermission("owner", "manageOwners")).toBe(true);
  expect(hasPermission("owner", "manageMembers")).toBe(true);
  expect(hasPermission("owner", "manageSettings")).toBe(true);
  expect(hasPermission("owner", "viewReports")).toBe(true);
  expect(hasPermission("owner", "overrideStop")).toBe(true);
  expect(hasPermission("owner", "eraseCustomer")).toBe(true);
  expect(hasPermission("owner", "exportWorkspace")).toBe(true);
  expect(hasPermission("owner", "sendTest")).toBe(true);
});

test("admin can run the workspace but cannot delete it or grant owner", () => {
  expect(isOwnerRole("admin")).toBe(false);
  expect(isAdminRole("admin")).toBe(true);
  expect(hasPermission("admin", "manageWorkspace")).toBe(false);
  expect(hasPermission("admin", "manageOwners")).toBe(false);
  expect(hasPermission("admin", "manageMembers")).toBe(true);
  expect(hasPermission("admin", "manageSettings")).toBe(true);
  expect(hasPermission("admin", "viewReports")).toBe(true);
  expect(hasPermission("admin", "overrideStop")).toBe(true);
  expect(hasPermission("admin", "eraseCustomer")).toBe(true);
  expect(hasPermission("admin", "exportWorkspace")).toBe(true);
  expect(hasPermission("admin", "sendTest")).toBe(true);
});

test("member has no management permissions", () => {
  expect(isAdminRole("member")).toBe(false);
  expect(hasPermission("member", "manageMembers")).toBe(false);
  expect(hasPermission("member", "manageSettings")).toBe(false);
  expect(hasPermission("member", "viewReports")).toBe(false);
  expect(hasPermission("member", "overrideStop")).toBe(false);
  expect(hasPermission("member", "eraseCustomer")).toBe(false);
  expect(hasPermission("member", "exportWorkspace")).toBe(false);
  expect(hasPermission("member", "sendTest")).toBe(false);
  expect(hasPermission("member", "manageWorkspace")).toBe(false);
});

test("assignableRoles: owner can grant owner; admin cannot", () => {
  expect(assignableRoles("owner")).toEqual(["owner", "admin", "member"]);
  expect(assignableRoles("admin")).toEqual(["admin", "member"]);
  expect(assignableRoles("member")).toEqual([]);
});
