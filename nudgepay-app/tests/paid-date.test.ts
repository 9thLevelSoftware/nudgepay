import { expect, test } from "vitest";
import { mergePaidDate, type ExistingPaidRow } from "../app/lib/paid-date";

const TODAY = "2026-08-21";

function existing(balance: number, paid_date: string | null): ExistingPaidRow {
  return { qbo_id: "1", balance, paid_date };
}

test("mergePaidDate: insert newly paid stamps syncToday", () => {
  expect(mergePaidDate({ existing: undefined, incomingBalance: 0, syncToday: TODAY })).toBe(TODAY);
});

test("mergePaidDate: first transition from open stamps syncToday", () => {
  expect(mergePaidDate({
    existing: existing(100, null), incomingBalance: 0, syncToday: TODAY,
  })).toBe(TODAY);
});

test("mergePaidDate: already stamped paid_date is preserved", () => {
  expect(mergePaidDate({
    existing: existing(0, "2026-01-01"), incomingBalance: 0, syncToday: TODAY,
  })).toBe("2026-01-01");
});

test("mergePaidDate: historically paid with null paid_date stays null", () => {
  expect(mergePaidDate({
    existing: existing(0, null), incomingBalance: 0, syncToday: TODAY,
  })).toBeNull();
});

test("mergePaidDate: reopened invoice clears paid_date", () => {
  expect(mergePaidDate({
    existing: existing(0, "2026-01-01"), incomingBalance: 50, syncToday: TODAY,
  })).toBeNull();
});

test("mergePaidDate: preserve paid_date even when prior balance was still open", () => {
  expect(mergePaidDate({
    existing: existing(50, "2026-01-01"), incomingBalance: 0, syncToday: TODAY,
  })).toBe("2026-01-01");
});
