import { describe, it, expect } from "vitest";
import {
  emptyQueueCopy,
  focusEmptyBody,
  FIRST_RUN_QUEUE_TITLE,
  FILTER_MISS_QUEUE_TITLE,
  HEALTHY_EMPTY_QUEUE_TITLE,
  RECONNECT_QUEUE_TITLE,
  PARTIAL_QUEUE_TITLE,
  FOCUS_HANDLED_EMPTY,
} from "../app/lib/empty-queue-copy";

describe("emptyQueueCopy", () => {
  it("uses first-run copy when QuickBooks is disconnected", () => {
    expect(emptyQueueCopy({ connected: false, view: "all-open", q: "" })).toEqual({
      title: FIRST_RUN_QUEUE_TITLE,
      clearSearch: false,
    });
  });

  it("uses healthy-empty copy for a connected all-open queue with no search", () => {
    const copy = emptyQueueCopy({ connected: true, view: "all-open", q: "" });
    expect(copy).toEqual({
      title: HEALTHY_EMPTY_QUEUE_TITLE,
      clearSearch: false,
    });
    expect(copy.title).not.toBe(FIRST_RUN_QUEUE_TITLE);
  });

  it("treats whitespace-only search as no search", () => {
    expect(emptyQueueCopy({ connected: true, view: "all-open", q: "   " })).toEqual({
      title: HEALTHY_EMPTY_QUEUE_TITLE,
      clearSearch: false,
    });
  });

  it("does not tell a first-run user to clear the search", () => {
    const copy = emptyQueueCopy({ connected: false, view: "all-open", q: "" });
    expect(copy.title).toBe("Connect QuickBooks to load overdue invoices.");
    expect(copy.clearSearch).toBe(false);
    expect(copy.title).not.toMatch(/clear the search/i);
  });

  it("uses filter-miss copy when search is nonempty", () => {
    expect(emptyQueueCopy({ connected: true, view: "all-open", q: "acme" })).toEqual({
      title: FILTER_MISS_QUEUE_TITLE,
      clearSearch: true,
    });
  });

  it("uses filter-miss copy when the view is not all-open", () => {
    expect(emptyQueueCopy({ connected: true, view: "30-plus", q: "" })).toEqual({
      title: FILTER_MISS_QUEUE_TITLE,
      clearSearch: true,
    });
  });

  it("keeps filter-miss copy for coming-due, waiting, and my-work", () => {
    for (const view of ["coming-due", "waiting", "my-work", "high-value"]) {
      expect(emptyQueueCopy({ connected: true, view, q: "" }), view).toEqual({
        title: "No accounts match this view.",
        clearSearch: true,
      });
    }
  });

  it("prefers first-run copy when disconnected even if a filter is on", () => {
    expect(emptyQueueCopy({ connected: false, view: "30-plus", q: "acme" })).toEqual({
      title: FIRST_RUN_QUEUE_TITLE,
      clearSearch: false,
    });
  });

  it("uses reconnect copy when the token is dead", () => {
    expect(emptyQueueCopy({
      connected: false, needsReconnect: true, view: "all-open", q: "",
    })).toEqual({
      title: RECONNECT_QUEUE_TITLE,
      clearSearch: false,
    });
    expect(emptyQueueCopy({
      connected: false, needsReconnect: true, view: "30-plus", q: "acme",
    }).title).not.toBe(FIRST_RUN_QUEUE_TITLE);
  });

  it("uses a partial banner distinct from healthy empty when truncated", () => {
    const copy = emptyQueueCopy({
      connected: true, view: "all-open", q: "", truncated: true,
    });
    expect(copy).toEqual({ title: PARTIAL_QUEUE_TITLE, clearSearch: false });
    expect(copy.title).not.toBe(HEALTHY_EMPTY_QUEUE_TITLE);
    expect(copy.title).not.toBe(FIRST_RUN_QUEUE_TITLE);
  });
});

describe("focusEmptyBody", () => {
  it("uses first-run copy when disconnected, not handled-or-on-hold", () => {
    expect(focusEmptyBody({ connected: false, heldCount: 0 })).toBe(FIRST_RUN_QUEUE_TITLE);
    expect(focusEmptyBody({ connected: false, heldCount: 0 })).not.toBe(FOCUS_HANDLED_EMPTY);
  });

  it("uses reconnect copy when the token is dead", () => {
    expect(focusEmptyBody({ connected: false, needsReconnect: true, heldCount: 0 }))
      .toBe(RECONNECT_QUEUE_TITLE);
  });

  it("uses handled copy when connected and nothing is held", () => {
    expect(focusEmptyBody({ connected: true, heldCount: 0 })).toBe(FOCUS_HANDLED_EMPTY);
  });

  it("uses held summary when connected and teammates hold cases", () => {
    expect(focusEmptyBody({
      connected: true, heldCount: 1, heldSummary: "A teammate is already working this account (Ada).",
    })).toBe("A teammate is already working this account (Ada).");
  });
});
