import { expect, test } from "vitest";
import { scorePriority, levelToRank, overrideToLevel } from "../app/lib/priority";

// --- factor bucket boundaries ---
test("age buckets: 0 contributes nothing, 1-29 -> 8, then 30/60/90", () => {
  const base = { balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false };
  const age = (d: number) => scorePriority({ ...base, ageDays: d }).factors.find((f) => f.key === "age")?.points;
  expect(age(0)).toBeUndefined();
  expect(age(1)).toBe(8);
  expect(age(29)).toBe(8);
  expect(age(30)).toBe(20);
  expect(age(60)).toBe(32);
  expect(age(90)).toBe(45);
});

test("balance buckets step at 1k/5k/10k/25k; zero balance contributes nothing", () => {
  const base = { ageDays: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false };
  const bal = (b: number) => scorePriority({ ...base, balance: b }).factors.find((f) => f.key === "balance")?.points;
  expect(bal(0)).toBeUndefined();
  expect(bal(999)).toBe(2);
  expect(bal(1000)).toBe(6);
  expect(bal(5000)).toBe(12);
  expect(bal(10000)).toBe(18);
  expect(bal(25000)).toBe(25);
});

test("silence buckets step at 7/14/30; never-contacted (null) is max silence", () => {
  const base = { ageDays: 0, balance: 0, brokenPromise: false, followUpDue: false };
  const sil = (d: number | null) => scorePriority({ ...base, daysSinceContact: d }).factors.find((f) => f.key === "silence")?.points;
  expect(sil(6)).toBeUndefined();
  expect(sil(7)).toBe(5);
  expect(sil(14)).toBe(10);
  expect(sil(30)).toBe(15);
  expect(sil(null)).toBe(15);
});

test("broken promise (+25) and follow-up-due (+12) are additive", () => {
  const base = { ageDays: 0, balance: 0, daysSinceContact: 0 };
  expect(scorePriority({ ...base, brokenPromise: true, followUpDue: false }).score).toBe(25);
  expect(scorePriority({ ...base, brokenPromise: false, followUpDue: true }).score).toBe(12);
  expect(scorePriority({ ...base, brokenPromise: true, followUpDue: true }).score).toBe(37);
});

// --- score → level thresholds ---
test("level thresholds at 25/50/80", () => {
  // craft scores precisely via factors: age gives 8/20/32/45, balance 2..25, etc.
  const low = scorePriority({ ageDays: 1, balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 8
  expect(low.level).toBe("Low");
  const medium = scorePriority({ ageDays: 30, balance: 1000, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 20+6=26
  expect(medium.level).toBe("Medium");
  const high = scorePriority({ ageDays: 90, balance: 0, brokenPromise: false, daysSinceContact: 7, followUpDue: false }); // 45+5=50
  expect(high.level).toBe("High");
  const critical = scorePriority({ ageDays: 90, balance: 10000, brokenPromise: true, daysSinceContact: 0, followUpDue: false }); // 45+18+25=88
  expect(critical.level).toBe("Critical");
});

test("factors are non-zero contributors sorted by points descending; reason joins the top two", () => {
  const s = scorePriority({ ageDays: 92, balance: 12000, brokenPromise: true, daysSinceContact: 30, followUpDue: true });
  expect(s.factors.map((f) => f.points)).toEqual([...s.factors.map((f) => f.points)].sort((a, b) => b - a));
  expect(s.factors.every((f) => f.points > 0)).toBe(true);
  expect(s.factors.find((f) => f.key === "silence")?.label).toBe("30 days since contact");
  expect(s.factors.find((f) => f.key === "age")?.label).toBe("92 days overdue");
  expect(s.reason).toContain(s.factors[0].label);
  expect(s.reason).toContain(s.factors[1].label); // reason joins the TOP TWO
});

test("empty factor set yields Low score 0 with 'Not yet due' reason", () => {
  const s = scorePriority({ ageDays: 0, balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false });
  expect(s.score).toBe(0);
  expect(s.level).toBe("Low");
  expect(s.factors).toEqual([]);
  expect(s.reason).toBe("Not yet due");
});

// --- override mapping ---
test("levelToRank orders Critical<High<Medium<Low", () => {
  expect(levelToRank("Critical")).toBe(0);
  expect(levelToRank("High")).toBe(1);
  expect(levelToRank("Medium")).toBe(2);
  expect(levelToRank("Low")).toBe(3);
});

test("overrideToLevel maps lowercase enum to PascalCase, null passes through", () => {
  expect(overrideToLevel("critical")).toBe("Critical");
  expect(overrideToLevel("high")).toBe("High");
  expect(overrideToLevel("medium")).toBe("Medium");
  expect(overrideToLevel("low")).toBe("Low");
  expect(overrideToLevel(null)).toBe(null);
});

// --- org-configurable thresholds (Phase 4) ---
test("scorePriority with no opts keeps the existing 25/50/80 defaults", () => {
  const low = scorePriority({ ageDays: 1, balance: 0, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 8
  expect(low.level).toBe("Low");
  const medium = scorePriority({ ageDays: 30, balance: 1000, brokenPromise: false, daysSinceContact: 0, followUpDue: false }); // 26
  expect(medium.level).toBe("Medium");
  const high = scorePriority({ ageDays: 90, balance: 0, brokenPromise: false, daysSinceContact: 7, followUpDue: false }); // 50
  expect(high.level).toBe("High");
  const critical = scorePriority({ ageDays: 90, balance: 10000, brokenPromise: true, daysSinceContact: 0, followUpDue: false }); // 88
  expect(critical.level).toBe("Critical");
});

test("custom thresholds shift levels: a score of 26 becomes Low when medium is raised above it", () => {
  const s = scorePriority(
    { ageDays: 30, balance: 1000, brokenPromise: false, daysSinceContact: 0, followUpDue: false }, // score 26
    { thresholds: { criticalMin: 80, highMin: 50, mediumMin: 30 } },
  );
  expect(s.score).toBe(26);
  expect(s.level).toBe("Low");
});

test("custom thresholds shift levels: lowering criticalMin promotes a High score to Critical", () => {
  const s = scorePriority(
    { ageDays: 90, balance: 0, brokenPromise: false, daysSinceContact: 7, followUpDue: false }, // score 50
    { thresholds: { criticalMin: 50, highMin: 30, mediumMin: 10 } },
  );
  expect(s.score).toBe(50);
  expect(s.level).toBe("Critical");
});

test("custom highValueThreshold shifts the 12-point balance tier", () => {
  const at5k = scorePriority({ ageDays: 0, balance: 5000, brokenPromise: false, daysSinceContact: 0, followUpDue: false });
  expect(at5k.factors.find((f) => f.key === "balance")?.points).toBe(12); // default org threshold (5000)

  const custom = scorePriority(
    { ageDays: 0, balance: 5000, brokenPromise: false, daysSinceContact: 0, followUpDue: false },
    { highValueThreshold: 8000 },
  );
  expect(custom.factors.find((f) => f.key === "balance")?.points).toBe(6); // below the raised org threshold, falls to the 1k tier

  const custom2 = scorePriority(
    { ageDays: 0, balance: 8000, brokenPromise: false, daysSinceContact: 0, followUpDue: false },
    { highValueThreshold: 8000 },
  );
  expect(custom2.factors.find((f) => f.key === "balance")?.points).toBe(12); // exactly at the raised threshold

  // 25k/10k/1k tiers stay fixed regardless of the org's high-value threshold.
  const unaffected = scorePriority(
    { ageDays: 0, balance: 25000, brokenPromise: false, daysSinceContact: 0, followUpDue: false },
    { highValueThreshold: 100 },
  );
  expect(unaffected.factors.find((f) => f.key === "balance")?.points).toBe(25);
});
