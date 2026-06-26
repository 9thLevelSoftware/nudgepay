import { expect, test } from "vitest";
import { loadOrgConfig } from "../app/lib/org-config.server";

// Stub a Supabase client that mimics the query chains used by loadOrgConfig:
//   org_settings: .from().select().eq().maybeSingle() → Promise<settingsResult>
//   org_holidays:  .from().select().eq()               → Promise<holidaysResult>
function stubClient(
  settingsResult: { data: unknown; error: unknown },
  holidaysResult: { data: unknown; error: unknown },
) {
  return {
    from(table: string) {
      const isSettings = table === "org_settings";
      return {
        select() {
          return {
            eq() {
              if (isSettings) {
                return { maybeSingle: async () => settingsResult };
              }
              return Promise.resolve(holidaysResult);
            },
          };
        },
      };
    },
  } as any;
}

test("loadOrgConfig throws when org_settings read errors", async () => {
  const client = stubClient(
    { data: null, error: { message: "boom" } },
    { data: [], error: null },
  );
  await expect(loadOrgConfig(client, "org-1")).rejects.toBeTruthy();
});

test("loadOrgConfig throws when org_holidays read errors", async () => {
  const client = stubClient(
    { data: null, error: null },
    { data: null, error: { message: "boom" } },
  );
  await expect(loadOrgConfig(client, "org-1")).rejects.toBeTruthy();
});
