// Explicit design-partner limits. Truncation is honest (page-all) — lists
// never pretend to be complete past this cap.

import { PAGE_ALL_MAX_ROWS } from "./page-all";

export const PILOT_MAX_LIST_ROWS = PAGE_ALL_MAX_ROWS;
export const PILOT_WORKSPACE_CAP = 10;
export const PILOT_CONCURRENT_STAFF_TARGET = 5;

export const PILOT_LIMIT_LINES = [
  `Queue, reports, and sync pages cap at ${PILOT_MAX_LIST_ROWS.toLocaleString("en-US")} rows per list. Truncated results are marked; they are not silently complete.`,
  `The controlled pilot admits up to ${PILOT_WORKSPACE_CAP} production workspaces.`,
  `The pilot target is ${PILOT_CONCURRENT_STAFF_TARGET} concurrently active staff per workspace, subject to load qualification; this is not a membership cap.`,
  "Roles are owner, admin, and member. Admins can run settings and reports; only owners can delete a workspace or grant owner.",
  "Owners and admins can download workspace customers, invoices, promises, and messages as JSON (5,000-row cap per list).",
  "You can download a copy of your NudgePay login data, then delete the login after leaving or deleting your workspace.",
  "NudgePay is a human follow-up queue, not automatic payment reminders, and is not a payment processor.",
  "A payment portal URL is your own page for message templates. NudgePay does not charge customers or queue quiet-hours blocks to send later.",
  "Workspace owners pay NudgePay by card. That is the agency subscription, not a charge to the agency's customers.",
] as const;
