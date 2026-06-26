import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

const svc = serviceClient();

async function newOrg(name: string) {
  const { data: org } = await svc.from("organizations").insert({ name }).select("id").single();
  return org!.id as string;
}

test("customers accepts a valid preferred_channel and the opt-out flags", async () => {
  const orgId = await newOrg("C6 schema ok");
  const { data, error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Acme", preferred_channel: "text", do_not_call: true })
    .select("preferred_channel, do_not_call, do_not_email, do_not_text").single();
  expect(error).toBeNull();
  expect(data!.preferred_channel).toBe("text");
  expect(data!.do_not_call).toBe(true);
  expect(data!.do_not_email).toBe(false); // default
  expect(data!.do_not_text).toBe(false);  // default
});

test("customers accepts a NULL preferred_channel (no preference)", async () => {
  const orgId = await newOrg("C6 schema null");
  const { error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "NoPref", preferred_channel: null });
  expect(error).toBeNull();
});

test("customers rejects an out-of-set preferred_channel", async () => {
  const orgId = await newOrg("C6 schema bad");
  const { error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "BadChan", preferred_channel: "fax" });
  expect(error).not.toBeNull();
});
