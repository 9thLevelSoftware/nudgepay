import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../app/lib/crypto.server";
import {
  disconnectConnection,
  getValidAccessToken,
  type QboRefreshRuntime,
} from "../app/lib/qbo-connection.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.test/cb" };

type Row = {
  realm_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
  connection_generation: number;
  refresh_lease_id: string | null;
  refresh_lease_expires_at: string | null;
};

class MemoryQboService {
  nowMs = Date.parse("2026-09-05T00:00:00Z");
  failCleanup = false;
  row: Row;

  constructor(row: Row) {
    this.row = row;
  }

  from(table: string) {
    if (table !== "qbo_connections") throw new Error(`unexpected table ${table}`);
    let patch: Partial<Row> | undefined;
    const filters: Array<(row: Row) => boolean> = [];
    const query = {
      select: () => {
        if (!patch) return query;
        if (!filters.every((matches) => matches(this.row))) {
          return Promise.resolve({ data: [], error: null });
        }
        const materialChange = [
          "realm_id", "access_token_enc", "refresh_token_enc", "token_expires_at", "status",
        ].some((key) => key in patch && patch[key as keyof Row] !== this.row[key as keyof Row]);
        this.row = { ...this.row, ...patch };
        if (materialChange) {
          this.row.connection_generation += 1;
          this.row.refresh_lease_id = null;
          this.row.refresh_lease_expires_at = null;
        }
        return Promise.resolve({ data: [{ org_id: "org-1" }], error: null });
      },
      update: (values: Partial<Row>) => { patch = values; return query; },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column as keyof Row] === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column as keyof Row] === value);
        return query;
      },
      maybeSingle: async () => ({ data: { ...this.row }, error: null }),
    };
    return query;
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_qbo_token_refresh") {
      if (this.row.status !== "connected" || !this.row.refresh_token_enc || !this.row.realm_id) {
        return { data: { state: "unavailable" }, error: null };
      }
      if (this.row.connection_generation !== args.p_expected_generation
        || this.row.realm_id !== args.p_expected_realm_id) {
        return { data: { state: "stale" }, error: null };
      }
      if (Date.parse(this.row.token_expires_at ?? "") > this.nowMs + 60_000) {
        return { data: { state: "ready" }, error: null };
      }
      if (this.row.refresh_lease_id
        && Date.parse(this.row.refresh_lease_expires_at ?? "") > this.nowMs) {
        return { data: { state: "wait" }, error: null };
      }
      this.row.refresh_lease_id = args.p_lease_id as string;
      this.row.refresh_lease_expires_at = new Date(this.nowMs + 30_000).toISOString();
      return { data: { state: "owner" }, error: null };
    }

    if (name === "finish_qbo_token_refresh") {
      const matches = this.matchesLease(args);
      if (matches) {
        this.row.access_token_enc = args.p_access_token_enc as string;
        this.row.refresh_token_enc = args.p_refresh_token_enc as string;
        this.row.token_expires_at = args.p_token_expires_at as string;
        this.row.refresh_lease_id = null;
        this.row.refresh_lease_expires_at = null;
        this.row.connection_generation += 1;
      }
      return { data: matches, error: null };
    }

    if (name === "fail_qbo_token_refresh") {
      if (this.failCleanup) return { data: null, error: { code: "db_cleanup_failed" } };
      const matches = this.matchesLease(args);
      if (matches) {
        this.row.refresh_lease_id = null;
        this.row.refresh_lease_expires_at = null;
        if (args.p_definitive === true) {
          this.row.status = "error";
          this.row.connection_generation += 1;
        }
      }
      return { data: matches, error: null };
    }

    throw new Error(`unexpected RPC ${name}`);
  }

  private matchesLease(args: Record<string, unknown>): boolean {
    return this.row.status === "connected"
      && this.row.connection_generation === args.p_expected_generation
      && this.row.realm_id === args.p_expected_realm_id
      && this.row.refresh_lease_id === args.p_lease_id;
  }

  async reconnect(realmId: string, accessToken: string, refreshToken: string): Promise<void> {
    this.row = {
      realm_id: realmId,
      access_token_enc: await encryptSecret(accessToken, KEY),
      refresh_token_enc: await encryptSecret(refreshToken, KEY),
      token_expires_at: new Date(this.nowMs + 3_600_000).toISOString(),
      status: "connected",
      connection_generation: this.row.connection_generation + 1,
      refresh_lease_id: null,
      refresh_lease_expires_at: null,
    };
  }

  disconnect(): void {
    this.row = {
      ...this.row,
      realm_id: null,
      access_token_enc: null,
      refresh_token_enc: null,
      token_expires_at: null,
      status: "disconnected",
      connection_generation: this.row.connection_generation + 1,
      refresh_lease_id: null,
      refresh_lease_expires_at: null,
    };
  }
}

async function expiredService(): Promise<MemoryQboService> {
  return new MemoryQboService({
    realm_id: "realm-old",
    access_token_enc: await encryptSecret("access-old", KEY),
    refresh_token_enc: await encryptSecret("refresh-old", KEY),
    token_expires_at: new Date(Date.parse("2026-09-05T00:00:00Z") - 1_000).toISOString(),
    status: "connected",
    connection_generation: 1,
    refresh_lease_id: null,
    refresh_lease_expires_at: null,
  });
}

function response(accessToken: string, refreshToken: string): Response {
  return new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function runtime(service: MemoryQboService, sleep?: (ms: number) => Promise<void>): QboRefreshRuntime {
  let id = 0;
  return {
    now: () => service.nowMs,
    sleep: sleep ?? (async (ms) => {
      service.nowMs += ms;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }),
    createLeaseId: () => `lease-${++id}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("durable QBO refresh coordination", () => {
  it("makes exactly one token POST for concurrent expired reads and lets the loser re-read", async () => {
    const service = await expiredService();
    const fetchFn = vi.fn(async () => response("access-new", "refresh-new"));
    const run = () => getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));

    const [first, second] = await Promise.all([run(), run()]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ accessToken: "access-new", realmId: "realm-old" });
    expect(second).toEqual(first);
    expect(await decryptSecret(service.row.refresh_token_enc!, KEY)).toBe("refresh-new");
  });

  it("does not let an earlier slow success overwrite a newer lease success", async () => {
    const service = await expiredService();
    const slow = deferred<Response>();
    const fetchFn = vi.fn()
      .mockImplementationOnce(async () => slow.promise)
      .mockImplementationOnce(async () => response("access-winner", "refresh-winner"));
    const first = getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    await waitFor(() => fetchFn.mock.calls.length >= 1);
    service.nowMs += 31_000;
    const second = await getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    slow.resolve(response("access-stale", "refresh-stale"));
    const firstResult = await first;

    expect(second.accessToken).toBe("access-winner");
    expect(firstResult.accessToken).toBe("access-winner");
    expect(await decryptSecret(service.row.refresh_token_enc!, KEY)).toBe("refresh-winner");
  });

  it("does not let a lagging failure mark a newer success as error", async () => {
    const service = await expiredService();
    const slow = deferred<Response>();
    const fetchFn = vi.fn()
      .mockImplementationOnce(async () => slow.promise)
      .mockImplementationOnce(async () => response("access-winner", "refresh-winner"));
    const first = getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    await waitFor(() => fetchFn.mock.calls.length >= 1);
    service.nowMs += 31_000;
    await getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    slow.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    await expect(first).rejects.toThrow(/QBO token request failed: 400/);
    expect(service.row.status).toBe("connected");
    expect(await decryptSecret(service.row.refresh_token_enc!, KEY)).toBe("refresh-winner");
  });

  it("rejects a stale success after disconnect", async () => {
    const service = await expiredService();
    const slow = deferred<Response>();
    const fetchFn = vi.fn(async () => slow.promise);
    const pending = getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    await waitFor(() => fetchFn.mock.calls.length >= 1);
    service.disconnect();
    slow.resolve(response("access-stale", "refresh-stale"));

    await expect(pending).rejects.toThrow(/not connected/);
    expect(service.row.status).toBe("disconnected");
  });

  it("returns the new connection after a stale old-realm success", async () => {
    const service = await expiredService();
    const slow = deferred<Response>();
    const fetchFn = vi.fn(async () => slow.promise);
    const pending = getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service));
    await waitFor(() => fetchFn.mock.calls.length >= 1);
    await service.reconnect("realm-new", "access-reconnected", "refresh-reconnected");
    slow.resolve(response("access-stale", "refresh-stale"));

    await expect(pending).resolves.toEqual({ accessToken: "access-reconnected", realmId: "realm-new" });
    expect(await decryptSecret(service.row.refresh_token_enc!, KEY)).toBe("refresh-reconnected");
  });

  it("fails a disconnect completion that races with a reconnect", async () => {
    const service = await expiredService();
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ token: "refresh-old" });
      await service.reconnect("realm-new", "access-reconnected", "refresh-reconnected");
      return new Response(null, { status: 200 });
    });

    await expect(disconnectConnection(fetchFn as any, service as any, cfg, KEY, "org-1"))
      .rejects.toThrow("QBO connection changed while revoke was in progress");
    expect(service.row.status).toBe("connected");
    expect(service.row.realm_id).toBe("realm-new");
    expect(await decryptSecret(service.row.refresh_token_enc!, KEY)).toBe("refresh-reconnected");
  });

  it("recovers from an abandoned lease after bounded waiting and expiry", async () => {
    const service = await expiredService();
    service.row.refresh_lease_id = "crashed-owner";
    service.row.refresh_lease_expires_at = new Date(service.nowMs + 100).toISOString();
    const fetchFn = vi.fn(async () => response("access-recovered", "refresh-recovered"));
    const clock = runtime(service, async (ms) => { service.nowMs += Math.max(ms, 101); });

    await expect(getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", clock))
      .resolves.toEqual({ accessToken: "access-recovered", realmId: "realm-old" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("releases a current lease after a transient provider failure without disconnecting", async () => {
    const service = await expiredService();
    const fetchFn = vi.fn(async () => new Response("temporary", { status: 503 }));

    await expect(getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service)))
      .rejects.toThrow(/QBO token request failed: 503/);
    expect(service.row.status).toBe("connected");
    expect(service.row.refresh_lease_id).toBeNull();
  });

  it("preserves the provider failure when lease cleanup fails", async () => {
    const service = await expiredService();
    service.failCleanup = true;
    const fetchFn = vi.fn(async () => new Response("temporary", { status: 503 }));

    await expect(getValidAccessToken(fetchFn as any, service as any, cfg, KEY, "org-1", runtime(service)))
      .rejects.toThrow("QBO token request failed: 503");
    expect(service.row.status).toBe("connected");
    expect(service.row.refresh_lease_id).not.toBeNull();
  });

  it("marks only a current invalid_grant lease as error", async () => {
    const current = await expiredService();
    const invalidGrant = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    await expect(getValidAccessToken(invalidGrant as any, current as any, cfg, KEY, "org-1", runtime(current)))
      .rejects.toThrow(/QBO token request failed: 400/);
    expect(current.row.status).toBe("error");

    const stale = await expiredService();
    const slow = deferred<Response>();
    const pending = getValidAccessToken(
      vi.fn(async () => slow.promise) as any,
      stale as any,
      cfg,
      KEY,
      "org-1",
      runtime(stale),
    );
    await waitFor(() => Boolean(stale.row.refresh_lease_id));
    await stale.reconnect("realm-new", "new-access", "new-refresh");
    slow.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    await expect(pending).rejects.toThrow(/QBO token request failed: 400/);
    expect(stale.row.status).toBe("connected");
    expect(stale.row.realm_id).toBe("realm-new");
  });

  it("migration uses lease and generation CAS and restricts RPC execution", () => {
    const sql = readFileSync(fileURLToPath(new URL(
      "../supabase/migrations/0062_qbo_refresh_coordination.sql",
      import.meta.url,
    )), "utf8");
    expect(sql).toMatch(/connection_generation bigint not null default 1/i);
    expect(sql).toMatch(/refresh_lease_expires_at timestamptz/i);
    expect(sql).toMatch(/create or replace function public\.claim_qbo_token_refresh/i);
    expect(sql).toMatch(/create or replace function public\.store_qbo_connection/i);
    expect(sql).toMatch(/create or replace function public\.finish_qbo_token_refresh/i);
    expect(sql).toMatch(/create or replace function public\.fail_qbo_token_refresh/i);
    expect(sql).toMatch(/connection_generation = p_expected_generation/i);
    expect(sql).toMatch(/refresh_lease_id = p_lease_id/i);
    expect(sql).toMatch(/revoke all on function public\.claim_qbo_token_refresh[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.store_qbo_connection[\s\S]*from public, anon, authenticated/i);
  });
});
