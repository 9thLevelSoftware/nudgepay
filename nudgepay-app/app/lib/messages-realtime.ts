// subscribeMessageEvents — instant inbox updates via Supabase Realtime.
//
// Listens to the per-org public broadcast channel populated by
// `notify_message_event` (migration 0051). The payload is content-free:
// { table, org_id, direction } — no body / from / to / customer_id. Treat
// the channel as public worst-case (A-005): orgId in the topic is a
// timing/volume oracle if it leaks; real thread bodies still flow through
// the RLS-checked loader. Anon key in the Messages loader is public-by-design.
//
// Toast policy lives here: inbound only. Omit/unknown direction → no toast
// (poll `/api/messages-activity` is the fallback). Subscribe errors are
// logged; a failed socket must never replace the 20s fingerprint poll.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const MESSAGE_EVENT_ALLOWED_KEYS = ["table", "org_id", "direction"] as const;

export type MessageEventPayload = {
  table?: string;
  org_id?: string;
  direction?: string;
};

export type MessageEventsClient = {
  channel: (name: string) => MessageEventsChannel;
  removeChannel: (channel: unknown) => unknown;
};

export type MessageEventsChannel = {
  on: (
    type: "broadcast",
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void,
  ) => MessageEventsChannel;
  subscribe: (callback?: (status: string, err?: Error) => void) => unknown;
};

let client: SupabaseClient | null = null;

function getClient(url: string, anonKey: string): SupabaseClient {
  client ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keep only content-free keys; drop body / from / to / customer_id if present. */
export function parseMessageEventPayload(raw: unknown): MessageEventPayload {
  const outer = asRecord(raw);
  if (!outer) return {};
  const inner = asRecord(outer.payload) ?? outer;
  const parsed: MessageEventPayload = {};
  if (typeof inner.table === "string") parsed.table = inner.table;
  if (typeof inner.org_id === "string") parsed.org_id = inner.org_id;
  if (typeof inner.direction === "string") parsed.direction = inner.direction;
  return parsed;
}

/** Toast iff direction is exactly inbound. Omit / unknown / outbound → silent. */
export function shouldToastInbound(payload: MessageEventPayload): boolean {
  return payload.direction === "inbound";
}

/** 20s poll fingerprint: a newer lastInboundAt means a customer reply landed. */
export function inboundFingerprintIsNewer(
  previous: string | null,
  current: string | null,
): boolean {
  return Boolean(current && current !== previous && (previous == null || current > previous));
}

/**
 * Mirrors `notify_message_event`: a realtime.send throw must not fail INSERT.
 * SQL uses `exception when others then raise warning` and still `return NEW`.
 */
export function notifyMessageEventSafe(send: () => void): "inserted" {
  try {
    send();
  } catch {
    // WARNING only — the row insert proceeds.
  }
  return "inserted";
}

/**
 * Subscribe to message events for one org. Returns an unsubscribe function.
 * Construction / subscribe failures no-op so the fingerprint poll stays in charge.
 */
export function subscribeMessageEvents(opts: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  orgId: string;
  onEvent: (payload: MessageEventPayload) => void;
  client?: MessageEventsClient;
}): () => void {
  try {
    const supabase: MessageEventsClient =
      opts.client ?? (getClient(opts.supabaseUrl, opts.supabaseAnonKey) as unknown as MessageEventsClient);
    const channel = supabase
      .channel(`org:messages:${opts.orgId}`)
      .on("broadcast", { event: "change" }, (message) => {
        opts.onEvent(parseMessageEventPayload(message));
      });

    channel.subscribe((status, err) => {
      if (status !== "SUBSCRIBED") {
        console.warn("[messages-realtime] subscribe", status, err ?? "");
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn("[messages-realtime] subscribe failed", err);
    return () => {};
  }
}
