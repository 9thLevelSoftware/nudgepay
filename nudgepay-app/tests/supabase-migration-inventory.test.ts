import { describe, expect, it } from "vitest";
import {
  fetchSupabaseMigrationInventory,
  parseSupabaseMigrationInventory,
  projectRefFromSupabaseUrl,
} from "../scripts/supabase-migration-inventory.mjs";

describe("Supabase Management API migration inventory", () => {
  it("derives only a hosted project ref from the sealed Supabase URL", () => {
    expect(projectRefFromSupabaseUrl("https://ajffjukmvltqxxtkkplq.supabase.co")).toBe("ajffjukmvltqxxtkkplq");
    expect(() => projectRefFromSupabaseUrl("https://example.com")).toThrow(/hosted Supabase URL/);
  });

  it("parses the documented migration history response into parity rows", () => {
    expect(parseSupabaseMigrationInventory([
      { version: "0001", name: "tenancy_schema" },
      { version: "0002", name: "rls_policies" },
    ])).toEqual([
      { local: "0001", remote: "0001" },
      { local: "0002", remote: "0002" },
    ]);
    expect(() => parseSupabaseMigrationInventory([{ version: "../bad", name: "x" }])).toThrow(/invalid schema/);
  });

  it("uses the sealed project endpoint and fails closed without exposing the token", async () => {
    const token = "sbp_test_token_value_1234567890";
    const fetchFn: typeof fetch = async (input, init) => {
      if (
        input !== "https://api.supabase.com/v1/projects/ajffjukmvltqxxtkkplq/database/migrations"
        || new Headers(init?.headers).get("Authorization") !== `Bearer ${token}`
        || init?.method !== "GET"
      ) return new Response("wrong request", { status: 400 });
      return Response.json([{ version: "0001", name: "tenancy_schema" }]);
    };
    await expect(fetchSupabaseMigrationInventory({
      projectRef: "ajffjukmvltqxxtkkplq",
      accessToken: token,
      fetchFn,
    })).resolves.toEqual([{ local: "0001", remote: "0001" }]);

    await expect(fetchSupabaseMigrationInventory({
      projectRef: "ajffjukmvltqxxtkkplq",
      accessToken: token,
      fetchFn: async () => new Response(`denied ${token}`, { status: 403 }),
    })).rejects.toThrow("HTTP 403");
    await expect(fetchSupabaseMigrationInventory({
      projectRef: "ajffjukmvltqxxtkkplq",
      accessToken: token,
      fetchFn: async () => new Response(`denied ${token}`, { status: 403 }),
    })).rejects.not.toThrow(token);
  });
});
