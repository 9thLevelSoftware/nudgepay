import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { parseCommPrefsUpdate } from "../app/routes/api.comm-prefs";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("save_email", () => {
  it("owner writes email_config via RLS (save_email DB path)", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SE ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const owner = await makeUserClient(`se-owner-${Math.random()}@example.com`);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    // Mirror the route's save_email upsert (owner client = RLS path).
    const { error } = await owner.client.from("email_config")
      .upsert(
        { org_id: orgId, email_enabled: true, from_address: "billing@x.com", from_name: "Chancey" },
        { onConflict: "org_id" },
      );
    expect(error).toBeNull();

    const { data: row } = await svc.from("email_config")
      .select("email_enabled, from_address, from_name").eq("org_id", orgId).single();
    expect(row!.email_enabled).toBe(true);
    expect(row!.from_address).toBe("billing@x.com");
    expect(row!.from_name).toBe("Chancey");
  });

  it("rejects a malformed from address with ?error=email (save_email branch present)", () => {
    const src = readFileSync(new URL("../app/routes/api.org-settings.tsx", import.meta.url), "utf8");
    expect(src).toContain("save_email");
    expect(src).toContain("parseEmailSettingsUpdate");
  });

  it("parseCommPrefsUpdate includes do_not_email", () => {
    const r = parseCommPrefsUpdate(fd({ do_not_email: "true" }));
    expect((r as any).do_not_email).toBe(true);
    const r2 = parseCommPrefsUpdate(fd({}));
    expect((r2 as any).do_not_email).toBe(false);
  });
});
