// Which contact_logs rows count as customer contact (last-contact, never-contacted).
// Internal notes / Focus snooze (method=note) must not look like a customer touch.

export function countsAsCustomerContact(method: string | null | undefined): boolean {
  return method === "call" || method === "text" || method === "email";
}
