// Explicit design-partner limits. Truncation is honest (page-all) — lists
// never pretend to be complete past this cap.

import { PAGE_ALL_MAX_ROWS } from "./page-all";

export const PILOT_MAX_LIST_ROWS = PAGE_ALL_MAX_ROWS;
export const PILOT_WORKSPACES_PER_USER = 1;

export const PILOT_LIMIT_LINES = [
  `Queue, reports, and sync pages cap at ${PILOT_MAX_LIST_ROWS.toLocaleString("en-US")} rows per list. Truncated results are marked; they are not silently complete.`,
  "Each signed-in user belongs to one workspace.",
  "Roles are owner and member only.",
  "Owners can download workspace customers, invoices, and messages as JSON (5,000-row cap per list).",
  "You can download a copy of your NudgePay login data, then delete the login after leaving or deleting your workspace.",
  "NudgePay is a human follow-up queue, not automatic payment reminders, and is not a payment processor.",
] as const;
