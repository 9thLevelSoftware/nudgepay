import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { serviceClient, makeUserClient } from "./helpers";

test("a member writes notes to an own-org customer (org-scoped)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Notes Org A" }).select("id").single();
  const a = await makeUserClient("notes-a@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: a.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "Notable Co" }).select("id").single();

  await a.client.from("customers")
    .update({ notes: "Prefers email; AP is Dana." }).eq("org_id", org!.id).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("notes").eq("id", cust!.id).single();
  expect(after!.notes).toBe("Prefers email; AP is Dana.");
});

test("an outsider cannot write notes (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Notes Org B" }).select("id").single();
  const owner = await makeUserClient("notes-owner@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, name: "Private Notes Co", notes: "original" }).select("id").single();

  const outsider = await makeUserClient("notes-outsider@example.com");
  await outsider.client.from("customers").update({ notes: "hacked" }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("notes").eq("id", cust!.id).single();
  expect(after!.notes).toBe("original"); // unchanged — RLS blocked it
});

test("api.account-notes is registered in routes.ts", () => {
  const table = readFileSync(new URL("../app/routes.ts", import.meta.url), "utf8");
  expect(table).toContain('"routes/api.account-notes.tsx"');
});
