import { expect, test } from "vitest";
import { QBO_FLASH, SYNC_FLASH } from "../app/lib/flash-copy";

test("QBO_FLASH covers connect result flags", () => {
  for (const key of ["connected", "disconnected", "confirm", "error", "forbidden", "unconfigured", "sync_error", "unsupported"]) {
    expect(QBO_FLASH[key], key).toBeTruthy();
    expect(QBO_FLASH[key].text.length).toBeGreaterThan(10);
  }
  expect(QBO_FLASH.unsupported.tone).toBe("err");
  expect(QBO_FLASH.unsupported.text).toMatch(/US/);
  expect(QBO_FLASH.unsupported.text).toMatch(/USD/);
});

test("SYNC_FLASH covers refresh result flags", () => {
  for (const key of ["ok", "error"]) {
    expect(SYNC_FLASH[key], key).toBeTruthy();
  }
});
