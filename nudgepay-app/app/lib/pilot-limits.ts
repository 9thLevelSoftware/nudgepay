// Explicit design-partner limits. Truncation is honest (page-all) — lists
// never pretend to be complete past this cap.

import { PAGE_ALL_MAX_ROWS } from "./page-all";

export const PILOT_MAX_LIST_ROWS = PAGE_ALL_MAX_ROWS;
export const WORKSPACES_PER_USER_CAP = 20;

export const PILOT_LIMIT_LINES = [
  `Queue, reports, and sync pages cap at ${PILOT_MAX_LIST_ROWS.toLocaleString("en-US")} rows per list. Truncated results are marked; they are not silently complete.`,
  `A signed-in user can belong to up to ${WORKSPACES_PER_USER_CAP} workspaces.`,
  "Roles are owner, admin, and member. Admins can run settings and reports; only owners can delete a workspace or grant owner.",
  "Owners and admins can download workspace customers, invoices, promises, and messages as JSON (5,000-row cap per list).",
  "You can download a copy of your NudgePay login data, then delete the login after leaving or deleting your workspace.",
  "NudgePay is a human follow-up queue, not automatic payment reminders, and is not a payment processor.",
  "A payment portal URL is your own page for message templates. NudgePay does not charge customers or queue quiet-hours blocks to send later.",
] as const;
