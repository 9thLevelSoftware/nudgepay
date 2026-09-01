import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { assertTestBudget } from "../app/lib/send-limits.server";
import { TEST_HOUR_CAP } from "../app/lib/send-limits";

const svc = serviceClient();

test("assertTestBudget refuses SMS when the test hour cap is already full", async () => {
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Test cap ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const rows = Array.from({ length: TEST_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    direction: "outbound",
    to_number: "+12295550000",
    body: `test ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  await expect(assertTestBudget(svc, "text_messages", { orgId }))
    .rejects.toThrow(/test send rate cap/i);
});

test("assertTestBudget refuses email when the test hour cap is already full", async () => {
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Test email cap ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const rows = Array.from({ length: TEST_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    direction: "outbound",
    to_address: "owner@chancey.test",
    subject: `test ${i}`,
    body: `test ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  await expect(assertTestBudget(svc, "email_messages", { orgId }))
    .rejects.toThrow(/test send rate cap/i);
});

test("assertTestBudget still allows SMS when prior texts are older than 1h", async () => {
  const now = new Date("2026-06-15T18:00:00Z");
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Test stale ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const stale = new Date(now.getTime() - 65 * 60_000).toISOString();
  const rows = Array.from({ length: TEST_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    direction: "outbound",
    to_number: "+12295550001",
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  await expect(assertTestBudget(svc, "text_messages", { orgId, now })).resolves.toBeUndefined();
});

test("assertTestBudget still allows email when prior emails are older than 1h", async () => {
  const now = new Date("2026-06-15T18:00:00Z");
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Test email stale ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const stale = new Date(now.getTime() - 65 * 60_000).toISOString();
  const rows = Array.from({ length: TEST_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    direction: "outbound",
    to_address: "owner@chancey.test",
    subject: `stale ${i}`,
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  await expect(assertTestBudget(svc, "email_messages", { orgId, now })).resolves.toBeUndefined();
});
