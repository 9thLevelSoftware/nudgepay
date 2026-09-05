import { expect, test } from "vitest";
import { assertLocalSupabaseUrl, assertSafeTestEnv } from "./load-env";

test("permits only the exact local Supabase REST endpoint", () => {
  expect(assertLocalSupabaseUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/");
  expect(assertLocalSupabaseUrl("http://[::1]:54321")).toBe("http://[::1]:54321/");
});

test.each([
  "https://project.supabase.co",
  "http://localhost:54321",
  "http://user:pass@127.0.0.1:54321",
  "http://127.0.0.1:54322",
  "http://127.0.0.1:54321/rest/v1",
])("rejects unsafe destructive target %s", (url) => {
  expect(() => assertLocalSupabaseUrl(url)).toThrow(/Refusing destructive test setup/);
});

test("requires both local test keys before setup", () => {
  expect(() => assertSafeTestEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "a" })).toThrow(/SERVICE_KEY/);
});
