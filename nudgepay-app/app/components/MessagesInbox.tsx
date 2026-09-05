// app/components/MessagesInbox.tsx
import { Form, Link } from "react-router";
import { inboxListCopy, type ThreadRow, type MessageTab, type MessageSort, type ChannelFilter } from "../lib/message-inbox";
import { formatInstant } from "../lib/dates";
import { Icon } from "./Icons";
import { useSearchShortcut } from "../lib/use-search-shortcut";

const TABS: { id: MessageTab; label: string }[] = [
  { id: "needs-reply", label: "Needs reply" },
  { id: "needs-attention", label: "Needs attention" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "all", label: "All" },
];
const SORTS: { id: MessageSort; label: string }[] = [
  { id: "recent", label: "Most recent" },
  { id: "oldest-waiting", label: "Oldest waiting" },
  { id: "name", label: "Customer (A–Z)" },
];
const CHANNELS: { id: ChannelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

interface Props {
  rows: ThreadRow[];
  tab: MessageTab;
  sort: MessageSort;
  search: string;
  counts: Record<MessageTab, number>;
  selectedId: string | null;
  selectedChannel: string | null;
  channel: ChannelFilter;
  channelCounts: { all: number; sms: number; email: number };
  timeZone?: string | null;
  loadError?: string | null;
  truncated?: boolean;
  connected?: boolean;
  needsReconnect?: boolean;
}

export function MessagesInbox({ rows, tab, sort, search, counts, selectedId, selectedChannel, channel, channelCounts, timeZone, loadError = null, truncated = false, connected, needsReconnect = false }: Props) {
  const searchRef = useSearchShortcut();
  const tabHref = (id: MessageTab) =>
    `?${new URLSearchParams({ tab: id, sort, channel, ...(search ? { q: search } : {}) }).toString()}`;
  const channelHref = (ch: ChannelFilter) =>
    `?${new URLSearchParams({ tab, sort, channel: ch, ...(search ? { q: search } : {}) }).toString()}`;
  const rowHref = (r: ThreadRow) =>
    `?${new URLSearchParams({ tab, sort, channel: r.channel, ...(search ? { q: search } : {}), customerId: r.customerId }).toString()}`;

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Messages</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        {/* Channel dimension lives in the header as a segmented control so the
            body keeps a single filter-pill row */}
        <div className="flex items-center rounded-md border border-border bg-panel p-0.5" aria-label="Channel filter">
          {CHANNELS.map((ch) => {
            const active = ch.id === channel;
            return (
              <Link
                key={ch.id} to={channelHref(ch.id)} aria-current={active ? "true" : undefined}
                className={[
                  "inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                  active
                    ? "bg-copper text-on-copper"
                    : "text-muted hover:text-text",
                ].join(" ")}
              >
                {ch.label}
                <span className={`font-mono text-[10px] tabular-nums ${active ? "text-on-copper" : "text-muted/70"}`}>
                  {channelCounts[ch.id]}
                </span>
              </Link>
            );
          })}
        </div>
        <Form method="get" action="/messages" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="channel" value={channel} />
          {selectedId ? <input type="hidden" name="customerId" value={selectedId} /> : null}
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow cursor-pointer">
            <Icon name="search" size={14} className="text-muted shrink-0" />
            <span className="sr-only">Search</span>
            <input
              ref={searchRef}
              id="msg-search" name="q" defaultValue={search} placeholder="Search customer…"
              className="w-40 bg-transparent text-sm placeholder:text-muted focus-visible:outline-none"
            />
          </label>
          <label className="sr-only" htmlFor="msg-sort">Sort</label>
          <select
            id="msg-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-9 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Message thread filters">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id} to={tabHref(t.id)} aria-current={active ? "page" : undefined}
              className={[
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border",
                active ? "bg-ink text-surface border-ink" : "bg-paper text-muted border-border hover:border-copper/50",
              ].join(" ")}
            >
              {t.label}
              <span className={active ? "text-surface/70" : "text-muted/70"}>{counts[t.id]}</span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          {inboxListCopy({
            loadError,
            truncated,
            rowCount: rows.length,
            connected,
            needsReconnect,
            filterMiss: search.trim() !== "" || tab !== "all" || channel !== "all",
          })}
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.customerId === selectedId && r.channel === selectedChannel;
            return (
              <li key={`${r.customerId}::${r.channel}`} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={rowHref(r)}
                  aria-current={selected ? "true" : undefined}
                  className={[
                    "relative flex flex-col gap-1 px-4 py-3",
                    "hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                  ].join(" ")}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <div className="flex items-center gap-2">
                    {r.needsReply ? <span className="w-1.5 h-1.5 rounded-full bg-copper shrink-0" aria-label="Needs reply" /> : null}
                    <span className="font-medium text-text truncate">{r.customerName}</span>
                    {r.channel === "sms" ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-copper/10 text-copper border border-copper/20">SMS</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-cool/10 text-cool border border-cool/20">Email</span>
                    )}
                    {r.needsAttention ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-hot/10 text-hot border border-hot/20">Failed</span>
                    ) : null}
                    {r.unansweredInbound > 0 ? (
                      <span
                        aria-label={`${r.unansweredInbound} unanswered`}
                        className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold bg-copper/10 text-copper border border-copper/20"
                      >
                        {r.unansweredInbound}
                      </span>
                    ) : null}
                  </div>
                  {r.channel === "email" && r.subjectSnippet ? (
                    <div className="text-xs text-text/70 font-medium truncate">{r.subjectSnippet}</div>
                  ) : null}
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="truncate">
                      {r.lastMessage ? (
                        <>
                          <span className="font-mono">{r.lastMessage.direction === "inbound" ? "← " : "→ "}</span>
                          {r.lastMessage.snippet || "(no text)"}
                        </>
                      ) : "No messages"}
                    </span>
                    {r.lastMessage ? <span className="ml-auto shrink-0 font-mono tabular-nums">{formatInstant(r.lastMessage.createdAt, timeZone)}</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
