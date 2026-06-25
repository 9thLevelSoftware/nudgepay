import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { recordSyncError, resolveSyncErrors } from "../app/lib/sync-errors.server";

async function newOrg(name: string): Promise<string> {
  const svc = serviceClient();
  const { data } = await svc.from("organizations").insert({ name }).select("id").single();
  return data!.id as string;
}

test("recordSyncError inserts a row and truncates the message to 500 chars", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org A");
  await recordSyncError(svc, { orgId, source: "manual", scope: "full", message: "x".repeat(600) });
  const { data } = await svc.from("sync_errors").select("source, scope, message, resolved_at").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("manual");
  expect(data![0].scope).toBe("full");
  expect((data![0].message as string).length).toBe(500);
  expect(data![0].resolved_at).toBe(null);
});

test("resolveSyncErrors with no scope resolves all unresolved for the org only", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org B");
  const otherOrgId = await newOrg("Rec Org B-other");
  await recordSyncError(svc, { orgId, source: "cron", scope: "cdc", message: "a" });
  await recordSyncError(svc, { orgId, source: "webhook", scope: "invoice:1", message: "b" });
  await recordSyncError(svc, { orgId: otherOrgId, source: "cron", scope: "cdc", message: "c" });

  await resolveSyncErrors(svc, { orgId });

  const { data: mine } = await svc.from("sync_errors").select("resolved_at").eq("org_id", orgId);
  expect(mine!.every((r) => r.resolved_at !== null)).toBe(true);
  const { data: other } = await svc.from("sync_errors").select("resolved_at").eq("org_id", otherOrgId);
  expect(other!.every((r) => r.resolved_at === null)).toBe(true); // untouched
});

test("resolveSyncErrors with a scope resolves only matching unresolved rows", async () => {
  const svc = serviceClient();
  const orgId = await newOrg("Rec Org C");
  await recordSyncError(svc, { orgId, source: "webhook", scope: "invoice:9", message: "a" });
  await recordSyncError(svc, { orgId, source: "webhook", scope: "customer:9", message: "b" });

  await resolveSyncErrors(svc, { orgId, scope: "invoice:9" });

  const { data } = await svc.from("sync_errors").select("scope, resolved_at").eq("org_id", orgId);
  const byScope = Object.fromEntries(data!.map((r) => [r.scope, r.resolved_at]));
  expect(byScope["invoice:9"]).not.toBe(null);
  expect(byScope["customer:9"]).toBe(null);
});
