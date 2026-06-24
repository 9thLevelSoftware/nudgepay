import { expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This app uses a MANUAL route table (app/routes.ts), not file-based routing.
// A resource/action route file that exists but was never added to the table is
// silently a 404 — tsc and the build both pass because registration is untyped
// data, so the form just POSTs into the void. This guards that whole class:
// every api.* / webhooks.* / auth.* route file must appear in routes.ts.
const routesDir = fileURLToPath(new URL("../app/routes", import.meta.url));
const routesTable = readFileSync(fileURLToPath(new URL("../app/routes.ts", import.meta.url)), "utf8");

const mustRegister = readdirSync(routesDir).filter((f) => /^(api|webhooks|auth)\..*\.tsx$/.test(f));

test("every api/webhooks/auth route file is registered in routes.ts", () => {
  expect(mustRegister.length).toBeGreaterThan(0); // guard against a bad glob
  const missing = mustRegister.filter((f) => !routesTable.includes(`"routes/${f}"`));
  expect(missing).toEqual([]);
});
