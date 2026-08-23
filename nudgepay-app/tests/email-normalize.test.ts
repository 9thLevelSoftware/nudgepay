import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeEmail } from "../app/lib/email-messaging.server";

test("normalizeEmail extracts a display-name address", () => {
  expect(normalizeEmail("user@example.com")).toBe("user@example.com");
  expect(normalizeEmail("Name <user@example.com>")).toBe("user@example.com");
  expect(normalizeEmail("  Acme AR < User@Example.com > ")).toBe("user@example.com");
  expect(normalizeEmail("")).toBe("");
});

test("email_norm generated column uses the same extract-then-lower semantics", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0044_inbound_orphans_email_and_email_norm.sql", import.meta.url), "utf8");
  expect(sql).toContain("create or replace function public.normalize_email");
  expect(sql).toContain("substring(raw from '<([^>]+)>')");
  expect(sql).toContain("public.normalize_email(email)");
  expect(sql).toContain("public.normalize_email(from_address)");
  expect(sql).not.toMatch(/generated always as \(lower\(btrim\(email\)\)\) stored/);
});
