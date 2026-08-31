import { expect, test } from "vitest";
import { readyzBody } from "../app/lib/readyz";

const providers = { qbo: true, twilio: false, email: true, operatorAlert: false };

test("readyz success includes provider flags and no reason", () => {
  expect(readyzBody({ ok: true, providers })).toEqual({ ok: true, providers });
});

test("readyz failure keeps 503 reason and still reports providers", () => {
  expect(readyzBody({ ok: false, reason: "db", providers })).toEqual({
    ok: false,
    reason: "db",
    providers,
  });
});
