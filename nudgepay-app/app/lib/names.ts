// Pure display-name helpers. No I/O. Used by orgs.server (roster), workspace
// chrome (initials), and any surface that shows a user label.

/**
 * Resolve the best display label for a user:
 * 1. display_name from auth user_metadata (trimmed)
 * 2. email local-part
 * 3. userId prefix (last resort)
 */
export function displayLabel(
  displayName: string | null | undefined,
  email: string | null | undefined,
  userId: string,
): string {
  const trimmed = displayName?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  if (email) return email.split("@")[0];
  return userId.slice(0, 8);
}

/**
 * Derive 1–2 character initials from a label (display name or email local-part).
 * Splits on whitespace, dots, hyphens, and underscores — first letter of the
 * first two parts, uppercased. Falls back to "?" for empty/blank input.
 */
export function initialsFrom(label: string): string {
  const parts = label.trim().split(/[\s.\-_]+/);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}
