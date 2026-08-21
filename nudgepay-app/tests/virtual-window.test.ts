import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  visibleWindow,
  QUEUE_ROW_H,
  QUEUE_CARD_H,
  QUEUE_OVERSCAN,
} from "../app/lib/virtual-window";

describe("visibleWindow", () => {
  it("returns an empty window when count is 0", () => {
    expect(visibleWindow({ scrollTop: 0, viewportH: 400, rowH: 56, count: 0, overscan: 8 }))
      .toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("returns an empty window when rowH is not positive", () => {
    expect(visibleWindow({ scrollTop: 0, viewportH: 400, rowH: 0, count: 10, overscan: 8 }))
      .toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(visibleWindow({ scrollTop: 0, viewportH: 400, rowH: -56, count: 10, overscan: 8 }))
      .toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("clamps a negative count", () => {
    expect(visibleWindow({ scrollTop: 0, viewportH: 400, rowH: 56, count: -4, overscan: 2 }))
      .toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("windows the first page with overscan only below", () => {
    // 400/50 = 8 rows in view; overscan 2 → end 10. start cannot go below 0.
    const w = visibleWindow({ scrollTop: 0, viewportH: 400, rowH: 50, count: 100, overscan: 2 });
    expect(w).toEqual({ start: 0, end: 10, padTop: 0, padBottom: 90 * 50 });
  });

  it("does not let start go negative when overscan exceeds the first index", () => {
    const w = visibleWindow({ scrollTop: 10, viewportH: 100, rowH: 50, count: 20, overscan: 8 });
    expect(w.start).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it("does not let end exceed count at the bottom of the list", () => {
    // first = floor(900/50)=18; last = ceil(1100/50)=22; +overscan 8 → 30, clamped to 20.
    const w = visibleWindow({ scrollTop: 900, viewportH: 200, rowH: 50, count: 20, overscan: 8 });
    expect(w.end).toBe(20);
    expect(w.padBottom).toBe(0);
  });

  it("windows a mid-list scroll", () => {
    // first = floor(1000/50)=20; last = ceil(1250/50)=25; overscan 3 → [17, 28)
    const w = visibleWindow({ scrollTop: 1000, viewportH: 250, rowH: 50, count: 100, overscan: 3 });
    expect(w).toEqual({ start: 17, end: 28, padTop: 17 * 50, padBottom: (100 - 28) * 50 });
  });

  it("keeps padTop + mounted rows + padBottom equal to the full list height", () => {
    const rowH = QUEUE_ROW_H;
    const count = 1000;
    const w = visibleWindow({
      scrollTop: 3200,
      viewportH: 720,
      rowH,
      count,
      overscan: QUEUE_OVERSCAN,
    });
    expect(w.padTop + (w.end - w.start) * rowH + w.padBottom).toBe(count * rowH);
    expect(w.start).toBeGreaterThan(0);
    expect(w.end).toBeLessThan(count);
  });

  it("treats negative scrollTop as 0", () => {
    const a = visibleWindow({ scrollTop: -40, viewportH: 200, rowH: 50, count: 10, overscan: 1 });
    const b = visibleWindow({ scrollTop: 0, viewportH: 200, rowH: 50, count: 10, overscan: 1 });
    expect(a).toEqual(b);
  });

  it("with overscan 0 mounts only rows that intersect the viewport", () => {
    const w = visibleWindow({ scrollTop: 100, viewportH: 100, rowH: 50, count: 20, overscan: 0 });
    expect(w.start).toBe(2);
    expect(w.end).toBe(4);
    expect(w.padTop).toBe(100);
    expect(w.padBottom).toBe(16 * 50);
  });

  it("treats a non-positive overscan as 0", () => {
    const zero = visibleWindow({ scrollTop: 100, viewportH: 100, rowH: 50, count: 20, overscan: 0 });
    const neg = visibleWindow({ scrollTop: 100, viewportH: 100, rowH: 50, count: 20, overscan: -3 });
    expect(neg).toEqual(zero);
  });

  it("covers a 1000-row desktop queue without mounting every row", () => {
    const w = visibleWindow({
      scrollTop: 0,
      viewportH: 800,
      rowH: QUEUE_ROW_H,
      count: 1000,
      overscan: QUEUE_OVERSCAN,
    });
    expect(w.start).toBe(0);
    expect(w.end - w.start).toBeLessThan(50);
    expect(w.end).toBe(Math.ceil(800 / QUEUE_ROW_H) + QUEUE_OVERSCAN);
    expect(w.padBottom).toBe((1000 - w.end) * QUEUE_ROW_H);
  });

  it("covers a 1000-row mobile queue without mounting every card", () => {
    const w = visibleWindow({
      scrollTop: 2160,
      viewportH: 700,
      rowH: QUEUE_CARD_H,
      count: 1000,
      overscan: QUEUE_OVERSCAN,
    });
    expect(w.end - w.start).toBeLessThan(40);
    expect(w.start).toBeGreaterThan(0);
    expect(w.end).toBeLessThan(1000);
  });

  it("end is exclusive and start is inclusive", () => {
    const w = visibleWindow({ scrollTop: 0, viewportH: 100, rowH: 50, count: 5, overscan: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(2);
    expect(w.end - w.start).toBe(2);
  });

  it("mounts the whole list when it fits in the viewport", () => {
    const w = visibleWindow({ scrollTop: 0, viewportH: 800, rowH: 50, count: 4, overscan: 8 });
    expect(w).toEqual({ start: 0, end: 4, padTop: 0, padBottom: 0 });
  });

  it("with a zero viewport still overscans around the scroll position", () => {
    const w = visibleWindow({ scrollTop: 250, viewportH: 0, rowH: 50, count: 40, overscan: 2 });
    // first = 5, last = ceil(250/50)=5, window [3, 7)
    expect(w.start).toBe(3);
    expect(w.end).toBe(7);
  });
});

describe("WorkQueue virtualization (NP-AUD-2026-050)", () => {
  it("windows desktop rows and mobile cards instead of mapping every item into the DOM", () => {
    const src = readFileSync(new URL("../app/components/WorkQueue.tsx", import.meta.url), "utf8");
    expect(src).toContain('from "../lib/virtual-window"');
    expect(src).toContain("visibleWindow(");
    expect(src).toContain("QUEUE_ROW_H");
    expect(src).toContain("QUEUE_CARD_H");
    expect(src).toMatch(/items\.slice\(\w+\.start, \w+\.end\)/);
    // Full-list maps into QueueRow / MobileCard were the original defect.
    expect(src).not.toMatch(/\{items\.map\(\(item\) =>/);
  });
});
