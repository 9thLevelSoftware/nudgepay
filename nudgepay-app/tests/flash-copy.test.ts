import { expect, test } from "vitest";
import { QBO_FLASH, SYNC_FLASH } from "../app/lib/flash-copy";

test("QBO_FLASH covers connect result flags", () => {
  for (const key of ["connected", "disconnected", "error", "forbidden", "unconfigured", "sync_error"]) {
    expect(QBO_FLASH[key], key).toBeTruthy();
    expect(QBO_FLASH[key].text.length).toBeGreaterThan(10);
  }
});

test("SYNC_FLASH covers refresh result flags", () => {
  for (const key of ["ok", "error"]) {
    expect(SYNC_FLASH[key], key).toBeTruthy();
  }
});
