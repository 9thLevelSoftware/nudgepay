import { describe, expect, it } from "vitest";
import { readPreferredOrgId, resolveOrg } from "../app/lib/session.server";

const STALE_ORG_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ORG_ID = "22222222-2222-4222-8222-222222222222";

function membershipsClient(
  rows: Array<{ org_id: string; role: string }>,
  error: Error | null = null,
) {
  let orderCalls = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      orderCalls += 1;
      return orderCalls === 2 ? Promise.resolve({ data: rows, error }) : this;
    },
  };
  return { from: () => query } as any;
}

describe("explicit workspace selection", () => {
  it("does not accept a UUID prefix followed by cookie garbage", () => {
    const request = new Request("https://app.example/dashboard", {
      headers: { Cookie: `nudgepay-org=${VALID_ORG_ID}garbage` },
    });

    expect(readPreferredOrgId(request)).toBeNull();
  });

  it("fails closed when memberships cannot be loaded", async () => {
    const loadError = new Error("membership lookup failed");

    await expect(resolveOrg(
      membershipsClient([], loadError),
      "user-1",
    )).rejects.toBe(loadError);
  });

  it("rejects an unsafe request when its selected workspace membership is stale", async () => {
    const headers = new Headers();
    const request = new Request("https://app.example/api/org-settings", {
      method: "POST",
      headers: { Cookie: `nudgepay-org=${STALE_ORG_ID}` },
    });

    const thrown = await resolveOrg(
      membershipsClient([{ org_id: VALID_ORG_ID, role: "owner" }]),
      "user-1",
      request,
      headers,
    ).then(
      () => null,
      (error) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(409);
  });

  it("rejects an unsafe request when its workspace selector is missing", async () => {
    const request = new Request("https://app.example/api/org-settings", {
      method: "POST",
    });

    const thrown = await resolveOrg(
      membershipsClient([{ org_id: VALID_ORG_ID, role: "owner" }]),
      "user-1",
      request,
      new Headers(),
    ).then(
      () => null,
      (error) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(409);
  });

  it("keeps an unsafe request pinned to a valid selected membership", async () => {
    const headers = new Headers();
    const request = new Request("https://app.example/api/org-settings", {
      method: "POST",
      headers: { Cookie: `nudgepay-org=${VALID_ORG_ID}` },
    });

    const org = await resolveOrg(
      membershipsClient([
        { org_id: STALE_ORG_ID, role: "owner" },
        { org_id: VALID_ORG_ID, role: "member" },
      ]),
      "user-1",
      request,
      headers,
    );

    expect(org).toEqual({ org_id: VALID_ORG_ID, role: "member" });
    expect(headers.get("Set-Cookie")).toBeNull();
  });

  it("recovers a safe request to a valid membership and corrects the stale cookie", async () => {
    const headers = new Headers();
    const request = new Request("https://app.example/dashboard", {
      headers: { Cookie: `nudgepay-org=${STALE_ORG_ID}` },
    });

    const org = await resolveOrg(
      membershipsClient([{ org_id: VALID_ORG_ID, role: "member" }]),
      "user-1",
      request,
      headers,
    );

    expect(org).toEqual({ org_id: VALID_ORG_ID, role: "member" });
    expect(headers.get("Set-Cookie")).toContain(`nudgepay-org=${VALID_ORG_ID}`);
  });

  it("selects and persists a workspace on a safe request without a selector", async () => {
    const headers = new Headers();
    const request = new Request("https://app.example/dashboard");

    const org = await resolveOrg(
      membershipsClient([{ org_id: VALID_ORG_ID, role: "member" }]),
      "user-1",
      request,
      headers,
    );

    expect(org).toEqual({ org_id: VALID_ORG_ID, role: "member" });
    expect(headers.get("Set-Cookie")).toContain(`nudgepay-org=${VALID_ORG_ID}`);
  });
});
