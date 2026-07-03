// Pure reducer for focus-mode session state. No I/O, no .server suffix.

export type TriageResult = "logged" | "texted" | "snoozed" | "skipped";

export type FocusSession = {
  /** caseIds frozen at session start — never reshuffled. */
  order: string[];
  /** Current position in the queue. */
  index: number;
  /** Per-case triage result (caseId → result). */
  results: Record<string, TriageResult>;
  /** Count of server-write actions (excludes skips). */
  actions: number;
};

export type FocusEvent =
  | { type: "resolve"; result: Exclude<TriageResult, "skipped"> }
  | { type: "skip" }
  | { type: "restart"; order: string[] };

export function initFocusSession(order: string[]): FocusSession {
  return { order, index: 0, results: {}, actions: 0 };
}

export function focusSessionReducer(s: FocusSession, e: FocusEvent): FocusSession {
  switch (e.type) {
    case "resolve": {
      const caseId = s.order[s.index];
      if (caseId == null) return s; // already done
      return {
        ...s,
        index: s.index + 1,
        results: { ...s.results, [caseId]: e.result },
        actions: s.actions + 1,
      };
    }
    case "skip": {
      const caseId = s.order[s.index];
      if (caseId == null) return s;
      return {
        ...s,
        index: s.index + 1,
        results: { ...s.results, [caseId]: "skipped" },
        // actions stays the same — skip doesn't count
      };
    }
    case "restart":
      return initFocusSession(e.order);
  }
}

/** Number of cases triaged (any disposition, including skip). */
export function triageCount(s: FocusSession): number {
  return Object.keys(s.results).length;
}

/** Whether the session is complete (all cases triaged or exhausted). */
export function isDone(s: FocusSession): boolean {
  return s.index >= s.order.length;
}
