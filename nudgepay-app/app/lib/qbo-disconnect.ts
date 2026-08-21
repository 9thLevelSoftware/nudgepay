// Pure QBO disconnect confirm helpers. No I/O — used by the settings dialog
// and the POST action so a typed-name mismatch never reaches token revoke.

export type QboDisconnectDecision =
  | { disconnect: true }
  | { disconnect: false; qbo: "confirm" };

/**
 * True when the typed confirm value matches the workspace name.
 * Trims both sides; comparison is case-insensitive. Empty (or non-string)
 * input never matches, including when the stored name is blank.
 */
export function orgNameMatches(typed: unknown, orgName: string): boolean {
  if (typeof typed !== "string") return false;
  const a = typed.trim();
  const b = orgName.trim();
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Gate used by the disconnect action: mismatch → no mutate, flash `confirm`. */
export function qboDisconnectDecision(
  typed: unknown,
  orgName: string,
): QboDisconnectDecision {
  return orgNameMatches(typed, orgName)
    ? { disconnect: true }
    : { disconnect: false, qbo: "confirm" };
}
