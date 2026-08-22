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
  /** Immediate undo target; only skips are undoable. */
  lastAction?: { caseId: string; index: number; result: TriageResult; actions: number } | null;
};

export type FocusEvent =
  | { type: "resolve"; result: Exclude<TriageResult, "skipped"> }
  | { type: "skip" }
  | { type: "undo" }
  | { type: "restore"; session: FocusSession }
  | { type: "restart"; order: string[] };

export function initFocusSession(order: string[]): FocusSession {
  return { order, index: 0, results: {}, actions: 0, lastAction: null };
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
        lastAction: null,
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
        lastAction: { caseId, index: s.index, result: "skipped", actions: s.actions },
      };
    }
    case "undo": {
      const action = s.lastAction;
      if (!action || action.result !== "skipped" || s.index !== action.index + 1) return s;
      const results = { ...s.results };
      delete results[action.caseId];
      return { ...s, index: action.index, results, actions: action.actions, lastAction: null };
    }
    case "restore":
      return e.session;
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
