// Pure presentation helper: maps a collection-case status to a chip tone.
// No I/O, no node:*, no .server — safe in client + server bundles.
// The tone is a semantic key; components map it to literal Tailwind classes
// (the v4 scanner needs literal class strings, so the class map lives there).
import type { CaseStatus } from "./cases";

export type ChipTone = "cool" | "copper" | "neutral";

export function statusChipTone(status: CaseStatus | string): ChipTone {
  switch (status) {
    case "promised":
      return "cool";
    case "new":
    case "working":
      return "copper";
    case "waiting":
    case "on_hold":
    case "resolved":
    default:
      return "neutral";
  }
}
