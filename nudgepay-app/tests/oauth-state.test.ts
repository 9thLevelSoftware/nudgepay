import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { createOAuthState, consumeOAuthState } from "../app/lib/oauth-state.server";

const svc = serviceClient();
async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "State Org" }).select("id").single();
  return data!.id as string;
}

test("create then consume returns the org and is single-use", async () => {
  const org = await freshOrg();
  const state = await createOAuthState(svc, org);
  expect(state.length).toBeGreaterThan(16);
  expect(await consumeOAuthState(svc, state)).toBe(org);
  // second consume fails (row deleted) — prevents replay
  await expect(consumeOAuthState(svc, state)).rejects.toThrow();
});

test("consume removes the row (cleanup verified)", async () => {
  const org = await freshOrg();
  const state = await createOAuthState(svc, org);
  await consumeOAuthState(svc, state);
  const { data } = await svc.from("oauth_states").select("state").eq("state", state).maybeSingle();
  expect(data).toBeNull();
});

test("unknown state is rejected", async () => {
  await expect(consumeOAuthState(svc, "does-not-exist")).rejects.toThrow();
});

test("expired state is rejected", async () => {
  const org = await freshOrg();
  const state = await createOAuthState(svc, org, -1); // already expired
  await expect(consumeOAuthState(svc, state)).rejects.toThrow();
});
