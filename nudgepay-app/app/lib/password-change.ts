// Pure password-change validation. No I/O — the route verifies the current
// password with GoTrue only after this helper accepts the fields.

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeFields = {
  currentPassword: unknown;
  newPassword: unknown;
  confirmPassword: unknown;
};

export type PasswordChangeDecision =
  | { ok: true; currentPassword: string; newPassword: string }
  | { ok: false; error: "password" };

function asPassword(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function passwordChangeDecision(fields: PasswordChangeFields): PasswordChangeDecision {
  const currentPassword = asPassword(fields.currentPassword);
  const newPassword = asPassword(fields.newPassword);
  const confirmPassword = asPassword(fields.confirmPassword);

  if (!currentPassword) return { ok: false, error: "password" };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "password" };
  if (newPassword !== confirmPassword) return { ok: false, error: "password" };
  if (newPassword === currentPassword) return { ok: false, error: "password" };
  return { ok: true, currentPassword, newPassword };
}

// Maps a GoTrue sign-in error to a flash flag. Never returns the raw message.
export function passwordChangeVerifyFlash(message: string): "wrong-password" | "password" {
  return message === "Invalid login credentials" ? "wrong-password" : "password";
}
