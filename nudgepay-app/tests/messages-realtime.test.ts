import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_EVENT_ALLOWED_KEYS,
  inboundFingerprintIsNewer,
  notifyMessageEventSafe,
  parseMessageEventPayload,
  shouldToastInbound,
  subscribeMessageEvents,
  type MessageEventPayload,
  type MessageEventsChannel,
  type MessageEventsClient,
} from "../app/lib/messages-realtime";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALLOWED = new Set<string>(MESSAGE_EVENT_ALLOWED_KEYS);

function payloadKeys(payload: MessageEventPayload): string[] {
  return Object.keys(payload);
}

function fakeClient(opts?: {
  subscribeStatus?: string;
  subscribeErr?: Error;
  throwOnChannel?: boolean;
}): {
  client: MessageEventsClient;
  emit: (raw: unknown) => void;
  removed: unknown[];
} {
  let eventCb: ((message: { payload?: unknown }) => void) | null = null;
  const removed: unknown[] = [];
  const channel: MessageEventsChannel = {
    on(_type, _filter, callback) {
      eventCb = callback;
      return channel;
    },
    subscribe(callback) {
      if (opts?.subscribeStatus) {
        callback?.(opts.subscribeStatus, opts.subscribeErr);
      }
      return channel;
    },
  };
  const client: MessageEventsClient = {
    channel(name) {
      if (opts?.throwOnChannel) throw new Error(`channel ${name} failed`);
      return channel;
    },
    removeChannel(ch) {
      removed.push(ch);
    },
  };
  return {
    client,
    emit(raw) {
      eventCb?.(raw as { payload?: unknown });
    },
    removed,
  };
}

describe("content-free realtime payload", () => {
  it("payload keys are a subset of { table, org_id, direction } and never include body", () => {
    const parsed = parseMessageEventPayload({
      table: "text_messages",
      org_id: "org-1",
      direction: "inbound",
      body: "secret invoice text",
      from: "+15551212",
      to: "+15550000",
      customer_id: "cust-1",
    });
    expect(payloadKeys(parsed).every((k) => ALLOWED.has(k))).toBe(true);
    expect(parsed).toEqual({
      table: "text_messages",
      org_id: "org-1",
      direction: "inbound",
    });
    expect(parsed).not.toHaveProperty("body");
  });

  it("unwraps supabase-js { payload } envelopes and drops unknown keys", () => {
    const parsed = parseMessageEventPayload({
      type: "broadcast",
      event: "change",
      payload: {
        table: "email_messages",
        org_id: "org-2",
        direction: "outbound",
        body: "<p>hi</p>",
      },
    });
    expect(payloadKeys(parsed).sort()).toEqual(["direction", "org_id", "table"]);
    expect(parsed).not.toHaveProperty("body");
  });

  it("SQL json_build_object only sends table, org_id, direction", () => {
    const sql = read("../supabase/migrations/0049_message_events_direction.sql");
    expect(sql).toMatch(/json_build_object\([\s\S]*'table'[\s\S]*'org_id'[\s\S]*'direction'/);
    expect(sql).not.toMatch(/NEW\.body/);
    expect(sql).not.toMatch(/NEW\.from/);
    expect(sql).not.toMatch(/NEW\.to_/);
    expect(sql).not.toMatch(/NEW\.customer_id/);
    expect(sql).toMatch(/realtime\.send\([\s\S]*,\s*false\s*\)/);
  });
});

describe("inbound-only toast", () => {
  it("toasts inbound and stays silent for outbound, omit, and unknown", () => {
    expect(shouldToastInbound({ direction: "inbound" })).toBe(true);
    expect(shouldToastInbound({ table: "text_messages", org_id: "o", direction: "inbound" })).toBe(true);
    expect(shouldToastInbound({ direction: "outbound" })).toBe(false);
    expect(shouldToastInbound({})).toBe(false);
    expect(shouldToastInbound({ direction: undefined })).toBe(false);
    expect(shouldToastInbound({ direction: "INBOUND" })).toBe(false);
    expect(shouldToastInbound({ direction: "unknown" })).toBe(false);
  });

  it("subscribe inbound fires toast; outbound and omit do not", () => {
    const { client, emit } = fakeClient({ subscribeStatus: "SUBSCRIBED" });
    const toasts: MessageEventPayload[] = [];
    subscribeMessageEvents({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      orgId: "org-1",
      client,
      onEvent: (payload) => {
        if (shouldToastInbound(payload)) toasts.push(payload);
      },
    });
    emit({ payload: { table: "text_messages", org_id: "org-1", direction: "inbound" } });
    emit({ payload: { table: "text_messages", org_id: "org-1", direction: "outbound" } });
    emit({ payload: { table: "text_messages", org_id: "org-1" } });
    emit({ payload: { table: "email_messages", org_id: "org-1", direction: "sideways" } });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.direction).toBe("inbound");
  });
});

describe("subscribe fallback to poll", () => {
  it("subscribe error is logged; poll fingerprint still drives inbound toast", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();
    const { client, removed } = fakeClient({
      subscribeStatus: "CHANNEL_ERROR",
      subscribeErr: new Error("ws blocked"),
    });
    const unsubscribe = subscribeMessageEvents({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      orgId: "org-1",
      client,
      onEvent,
    });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("[messages-realtime]"))).toBe(true);
    unsubscribe();
    expect(removed).toHaveLength(1);

    // Subscribe failed: no toast from the socket. Poll fingerprint still works.
    expect(shouldToastInbound({ direction: "inbound" })).toBe(true);
    expect(inboundFingerprintIsNewer(null, "2026-08-23T12:00:00Z")).toBe(true);
    expect(inboundFingerprintIsNewer("2026-08-23T12:00:00Z", "2026-08-23T12:00:01Z")).toBe(true);
    expect(inboundFingerprintIsNewer("2026-08-23T12:00:01Z", "2026-08-23T12:00:01Z")).toBe(false);
    expect(inboundFingerprintIsNewer("2026-08-23T12:00:01Z", null)).toBe(false);
    warn.mockRestore();
  });

  it("construction failure returns a no-op unsubscribe so poll remains in charge", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();
    const { client } = fakeClient({ throwOnChannel: true });
    const unsubscribe = subscribeMessageEvents({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      orgId: "org-1",
      client,
      onEvent,
    });
    expect(() => unsubscribe()).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(inboundFingerprintIsNewer("t0", "t1")).toBe(true);
    warn.mockRestore();
  });

  it("activity poll loader selects only created_at (no body)", () => {
    const src = read("../app/routes/api.messages-activity.tsx");
    expect(src).toContain('.select("created_at")');
    expect(src).toContain('.eq("direction", "inbound")');
    expect(src).not.toMatch(/select\("[^"]*body/);
  });
});

describe("loader remains source of thread bodies", () => {
  it("Messages loader still selects bodies; broadcast path never caches payload.body", () => {
    const route = read("../app/routes/messages.tsx");
    expect(route).toMatch(/select\("customer_id, direction, body/);
    expect(route).toContain("subscribeMessageEvents");
    expect(route).toContain("shouldToastInbound");
    expect(route).toContain("inboundFingerprintIsNewer");
    expect(route).toContain("/api/messages-activity");
    expect(route).not.toMatch(/payload\.body/);

    const realtime = read("../app/lib/messages-realtime.ts");
    expect(realtime).toContain("content-free");
    expect(realtime).not.toMatch(/payload\.body/);
    expect(realtime).toContain("public worst-case");
  });
});

describe("INSERT-safety wrapper", () => {
  it("CREATE OR REPLACE keeps search_path='' and WARNING so a ping never fails INSERT", () => {
    const sql = read("../supabase/migrations/0049_message_events_direction.sql");
    expect(sql).toMatch(/create or replace function public\.notify_message_event\(\)/);
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(/exception when others then/);
    expect(sql).toMatch(/raise warning 'message broadcast ping failed: %'/);
    expect(sql).toMatch(/return NEW;/);
    expect(sql).toMatch(/after insert on text_messages/);
    expect(sql).toMatch(/after insert on email_messages/);
  });

  it("simulated realtime.send throw still allows text_messages INSERT", () => {
    const send = vi.fn(() => {
      throw new Error("realtime.send failed");
    });
    expect(notifyMessageEventSafe(send)).toBe("inserted");
    expect(send).toHaveBeenCalled();
  });
});
