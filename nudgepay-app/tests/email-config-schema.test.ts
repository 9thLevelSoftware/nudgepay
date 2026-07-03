// tests/email-config-schema.test.ts
// Phase 8 cleanup (migration 0031): email_config.provider was dead weight —
// added in 0020 as groundwork, never read or written by app code. Assert it's
// actually gone, and that the columns app code does use still round-trip.
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

const svc = serviceClient();

test("email_config no longer has a provider column", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Email schema" }).select("id").single();
  const { error } = await svc.from("email_config")
    .insert({ org_id: org!.id, provider: "resend" });
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/provider/i);
});

test("email_config still accepts and round-trips its real columns", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Email schema ok" }).select("id").single();
  const { data, error } = await svc.from("email_config")
    .insert({
      org_id: org!.id, email_enabled: true, from_address: "billing@example.com",
      from_name: "Example Billing", postal_address: "123 Main St",
    })
    .select("email_enabled, from_address, from_name, postal_address").single();
  expect(error).toBeNull();
  expect(data).toEqual({
    email_enabled: true, from_address: "billing@example.com",
    from_name: "Example Billing", postal_address: "123 Main St",
  });
});
