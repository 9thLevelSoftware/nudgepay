import { expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRESENCE_CUSTOMER_ID_BATCH_SIZE, readPresence } from "../app/lib/presence.server";

type QueryResult = { data: unknown; error: unknown };
type PresenceQuery = {
  table: string;
  selectedColumns: string;
  orgColumn: string;
  orgId: string;
  customerColumn: string;
  customerIds: string[];
};
type QueryHandler = (query: PresenceQuery) => Promise<QueryResult>;

function presenceClient(handler: QueryHandler): { client: SupabaseClient; queries: PresenceQuery[] } {
  const queries: PresenceQuery[] = [];
  const client = {
    from: (table: string) => ({
      select: (selectedColumns: string) => ({
        eq: (orgColumn: string, orgId: string) => ({
          in: (customerColumn: string, customerIds: string[]) => {
            const query = { table, selectedColumns, orgColumn, orgId, customerColumn, customerIds };
            queries.push(query);
            return handler(query);
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, queries };
}

function customers(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("readPresence batches 5,001 UUID-sized customer IDs and preserves org scope", async () => {
  const customerIds = customers(5_001);
  const fake = presenceClient(async (query) => ({
    data: [{ customer_id: query.customerIds[0], user_id: "user-1", last_seen_at: "2026-01-01T00:00:00Z" }],
    error: null,
  }));

  const rows = await readPresence(fake.client, {
    orgId: "org-1",
    customerIds: [...customerIds, customerIds[0]],
  });

  expect(fake.queries).toHaveLength(Math.ceil(customerIds.length / PRESENCE_CUSTOMER_ID_BATCH_SIZE));
  expect(fake.queries.map((query) => query.customerIds)).toEqual(
    Array.from(
      { length: Math.ceil(customerIds.length / PRESENCE_CUSTOMER_ID_BATCH_SIZE) },
      (_, index) => customerIds.slice(index * PRESENCE_CUSTOMER_ID_BATCH_SIZE, (index + 1) * PRESENCE_CUSTOMER_ID_BATCH_SIZE),
    ),
  );
  expect(fake.queries.every((query) =>
    query.table === "case_presence"
    && query.selectedColumns === "customer_id, user_id, last_seen_at"
    && query.orgColumn === "org_id"
    && query.orgId === "org-1"
    && query.customerColumn === "customer_id"
    && query.customerIds.length <= PRESENCE_CUSTOMER_ID_BATCH_SIZE,
  )).toBe(true);
  expect(rows).toHaveLength(fake.queries.length);
});

test("readPresence limits in-flight reads to four and aggregates out-of-order batches in input order", async () => {
  const pending: { query: PresenceQuery; resolve: (result: QueryResult) => void }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fake = presenceClient((query) => new Promise<QueryResult>((resolve) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push({
      query,
      resolve: (result) => {
        inFlight -= 1;
        resolve(result);
      },
    });
  }));
  const operation = readPresence(fake.client, { orgId: "org-1", customerIds: customers(401) });

  expect(fake.queries).toHaveLength(4);
  expect(maxInFlight).toBe(4);

  pending[3].resolve({
    data: [{ customer_id: pending[3].query.customerIds[0], user_id: "user-3", last_seen_at: "2026-01-01T00:00:00Z" }],
    error: null,
  });
  await flushPromises();
  expect(fake.queries).toHaveLength(5);
  expect(maxInFlight).toBe(4);

  for (const index of [1, 0, 2, 4]) {
    pending[index].resolve({
      data: [{ customer_id: pending[index].query.customerIds[0], user_id: `user-${index}`, last_seen_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });
  }

  await expect(operation).resolves.toEqual(
    pending.map((request, index) => ({
      customer_id: request.query.customerIds[0],
      user_id: `user-${index}`,
      last_seen_at: "2026-01-01T00:00:00Z",
    })),
  );
});

test("readPresence returns no rows and does not query for empty customer input", async () => {
  const fake = presenceClient(async () => ({ data: [], error: null }));

  await expect(readPresence(fake.client, { orgId: "org-1", customerIds: [] })).resolves.toEqual([]);
  expect(fake.queries).toEqual([]);
});

test("readPresence rejects after a later batch fails without returning partial rows or dispatching more work", async () => {
  const pending: { resolve: (result: QueryResult) => void }[] = [];
  const fake = presenceClient(() => new Promise<QueryResult>((resolve) => pending.push({ resolve })));
  const operation = readPresence(fake.client, { orgId: "org-1", customerIds: customers(501) });

  expect(fake.queries).toHaveLength(4);
  pending[0].resolve({
    data: [{ customer_id: "partial-customer", user_id: "user-1", last_seen_at: "2026-01-01T00:00:00Z" }],
    error: null,
  });
  await flushPromises();
  expect(fake.queries).toHaveLength(5);

  pending[1].resolve({ data: [], error: new Error("query failed") });
  await expect(operation).rejects.toThrow("query failed");

  pending[2].resolve({ data: [], error: null });
  pending[3].resolve({ data: [], error: null });
  pending[4].resolve({ data: [], error: null });
  await flushPromises();
  expect(fake.queries).toHaveLength(5);
});

test("readPresence stops dispatching when a transport rejection has a falsy reason", async () => {
  const pending: { resolve: (result: QueryResult) => void; reject: (reason: unknown) => void }[] = [];
  const fake = presenceClient(() => new Promise<QueryResult>((resolve, reject) => pending.push({ resolve, reject })));
  const operation = readPresence(fake.client, { orgId: "org-1", customerIds: customers(401) });

  expect(fake.queries).toHaveLength(4);
  pending[0].reject(undefined);
  await expect(operation).rejects.toBeUndefined();

  pending[1].resolve({ data: [], error: null });
  pending[2].resolve({ data: [], error: null });
  pending[3].resolve({ data: [], error: null });
  await flushPromises();
  expect(fake.queries).toHaveLength(4);
});
