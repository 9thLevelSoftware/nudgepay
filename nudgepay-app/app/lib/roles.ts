// Workspace roles and the permissions they grant. Pure — no I/O — so routes,
// chrome, and tests share one decision. Owner stays the only role that can
// delete a workspace or grant/revoke owner.

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "manageWorkspace",
  "manageOwners",
  "manageMembers",
  "manageSettings",
  "viewReports",
  "overrideStop",
  "eraseCustomer",
  "exportWorkspace",
  "sendTest",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Permission, readonly Role[]> = {
  manageWorkspace: ["owner"],
  manageOwners: ["owner"],
  manageMembers: ["owner", "admin"],
  manageSettings: ["owner", "admin"],
  viewReports: ["owner", "admin"],
  overrideStop: ["owner", "admin"],
  eraseCustomer: ["owner", "admin"],
  exportWorkspace: ["owner", "admin"],
  sendTest: ["owner", "admin"],
};

export function parseRole(role: string | null | undefined): Role | null {
  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
}

export function hasPermission(
  role: string | null | undefined,
  permission: Permission,
): boolean {
  const parsed = parseRole(role);
  if (!parsed) return false;
  return GRANTS[permission].includes(parsed);
}

export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function assignableRoles(actorRole: string | null | undefined): Role[] {
  if (isOwnerRole(actorRole)) return ["owner", "admin", "member"];
  if (hasPermission(actorRole, "manageMembers")) return ["admin", "member"];
  return [];
}
