// tests/account-notes-schema.test.ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

const svc = serviceClient();

test("customers accepts notes + notes_updated_at/by", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Notes schema" }).select("id").single();
  const { data, error } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "NoteCo", notes: "Called twice, prefers Mondays." })
    .select("notes, notes_updated_at, notes_updated_by").single();
  expect(error).toBeNull();
  expect(data!.notes).toBe("Called twice, prefers Mondays.");
  expect(data!.notes_updated_at).toBeNull();
  expect(data!.notes_updated_by).toBeNull();
});

test("notes defaults to null", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Notes null" }).select("id").single();
  const { data } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "NoNote" }).select("notes").single();
  expect(data!.notes).toBeNull();
});
