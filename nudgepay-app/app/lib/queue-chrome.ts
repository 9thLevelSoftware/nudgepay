// Pure dashboard / accounts URL chrome. No I/O.

import type { AccountFilter, AccountSort } from "./accounts";
import type { SortId, ViewId } from "./worklist";

export type EntityMode = "customers" | "invoices";
export type DensityId = "general" | "detailed" | "risk";

export const ENTITY_MODES: EntityMode[] = ["customers", "invoices"];
export const DENSITY_IDS: DensityId[] = ["general", "detailed", "risk"];
export const ACCOUNTS_DENSITY_IDS: DensityId[] = ["general", "risk"];
export const DENSITY_STORAGE_KEY = "np.queue.density";

export const VALID_SORTS: SortId[] = [
  "recommended", "most-overdue", "highest-balance", "customer", "due-date",
];

export type DashboardChrome = {
  view: ViewId;
  sort: SortId;
  q?: string;
  entity?: EntityMode;
  density?: DensityId;
  case?: string | null;
  invoice?: string | null;
  tab?: string | null;
};

export function parseEntityMode(raw: string | null | undefined): EntityMode {
  return raw === "invoices" ? "invoices" : "customers";
}

export function parseDensity(raw: string | null | undefined): DensityId {
  return raw === "detailed" || raw === "risk" ? raw : "general";
}

/** Accounts is General | Risk. `detailed` displays as General and is not written back. */
export function parseAccountsDensity(raw: string | null | undefined): DensityId {
  return raw === "risk" ? "risk" : "general";
}

export function parseSort(raw: string | null | undefined): SortId {
  return (VALID_SORTS as string[]).includes(raw ?? "") ? (raw as SortId) : "recommended";
}

/**
 * Always emits view + sort.
 * Emits density whenever `p.density` is set — including `general` — so a
 * click on General cannot look like “no param” and get overwritten by localStorage.
 * Omits entity/tab when they are the default. Omits density only when undefined
 * (first landing; hydrate may then restore).
 */
export function dashboardSearchParams(p: DashboardChrome): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("view", p.view);
  sp.set("sort", p.sort);
  if (p.q) sp.set("q", p.q);
  if (p.entity && p.entity !== "customers") sp.set("entity", p.entity);
  if (p.density != null) sp.set("density", p.density);
  if (p.case) sp.set("case", p.case);
  if (p.invoice) sp.set("invoice", p.invoice);
  if (p.tab && p.tab !== "overview") sp.set("tab", p.tab);
  return sp;
}

export function dashboardHref(p: DashboardChrome): string {
  return `?${dashboardSearchParams(p).toString()}`;
}

export function accountsSearchParams(p: {
  filter: AccountFilter;
  sort: AccountSort;
  q?: string;
  density?: DensityId;
  customerId?: string | null;
}): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("filter", p.filter);
  sp.set("sort", p.sort);
  if (p.q) sp.set("q", p.q);
  if (p.density != null) sp.set("density", p.density);
  if (p.customerId) sp.set("customerId", p.customerId);
  return sp;
}

export function accountsHref(p: {
  filter: AccountFilter;
  sort: AccountSort;
  q?: string;
  density?: DensityId;
  customerId?: string | null;
}): string {
  return `?${accountsSearchParams(p).toString()}`;
}
