export const E2E_PASSWORD = "NudgePay-e2e-password-123!";

export const E2E_USERS = {
  owner: { email: "owner@nudgepay-e2e.local", label: "E2E Owner", role: "owner" },
  admin: { email: "admin@nudgepay-e2e.local", label: "E2E Admin", role: "admin" },
  member: { email: "member@nudgepay-e2e.local", label: "E2E Member", role: "member" },
  outsider: { email: "outsider@nudgepay-e2e.local", label: "Other Tenant Owner", role: "owner" },
} as const;

export const E2E_IDS = {
  primaryOrg: "00000000-0000-4000-8000-00000000e201",
  otherOrg: "00000000-0000-4000-8000-00000000e202",
  mutationCustomer: "00000000-0000-4000-8000-00000000e301",
  promiseCustomer: "00000000-0000-4000-8000-00000000e302",
  messageCustomer: "00000000-0000-4000-8000-00000000e303",
  otherCustomer: "00000000-0000-4000-8000-00000000e304",
  mutationInvoice: "00000000-0000-4000-8000-00000000e401",
  promiseInvoice: "00000000-0000-4000-8000-00000000e402",
  messageInvoice: "00000000-0000-4000-8000-00000000e403",
  otherInvoice: "00000000-0000-4000-8000-00000000e404",
  mutationCase: "00000000-0000-4000-8000-00000000e501",
  promiseCase: "00000000-0000-4000-8000-00000000e502",
  messageCase: "00000000-0000-4000-8000-00000000e503",
  otherCase: "00000000-0000-4000-8000-00000000e504",
  existingPromise: "00000000-0000-4000-8000-00000000e601",
} as const;

export const E2E_LABELS = {
  primaryOrg: "NudgePay E2E Primary Tenant",
  otherOrg: "NudgePay E2E Other Tenant",
  mutationCustomer: "Beacon Office Supply",
  promiseCustomer: "Copper Ridge Builders",
  messageCustomer: "Delta Service Group",
  otherCustomer: "Hidden Cross-Tenant Customer",
} as const;
