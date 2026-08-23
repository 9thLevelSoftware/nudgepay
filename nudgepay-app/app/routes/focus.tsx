// /focus — Focus Mode. Full-screen, dark (bg-ink), keyboard-driven triage deck.
// One case at a time: Why now, contact/invoice summary, Log call / Send text /
// Snooze / Skip. No AppShell — standalone route.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, data, redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireOrgUser } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { loadCaseQueueSource } from "../lib/case-queue.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { DEFAULT_ORG_CONFIG } from "../lib/org-config";
import { todayInTz } from "../lib/tz";
import { buildCaseItems, type CaseItem } from "../lib/cases";
import { collisionState, type Collision } from "../lib/collision";
import { buildFocusQueue, dropLivePresenceCases, type FocusScope } from "../lib/focus-queue";
import {
  initFocusSession, focusSessionReducer, triageCount, isDone,
  type FocusSession, type FocusEvent,
} from "../lib/focus-session";
import { whyNow as computeWhyNow } from "../lib/next-best-action";
import {
  buildTimeline,
  type TimelineEntry, type TimelineLogInput, type TimelineSmsInput,
} from "../lib/timeline";
import { OUTCOME_LABELS } from "../lib/timeline";
import { useFocusKeys, type FocusKey } from "../lib/use-focus-keys";
import { FocusCard } from "../components/focus/FocusCard";
import { LogCallMiniForm } from "../components/focus/LogCallMiniForm";
import { SendTextMiniForm } from "../components/focus/SendTextMiniForm";
import { formatDate, formatInstant } from "../lib/dates";
import { pageTitle } from "../lib/meta";
import { smsFlashCopy } from "../lib/flash-copy";
import { chunkIds, orderPage, pageAllChunked, PAGE_ALL_MAX_ROWS } from "../lib/page-all";
import type { Route } from "./+types/focus";

export const meta: Route.MetaFunction = () => pageTitle("Focus Mode");

// Presence heartbeat interval (matches DetailPanel).
const HEARTBEAT_MS = 20_000;
const FOCUS_SESSION_STORAGE_KEY = "nudgepay:focus-session:v1";

function sessionMatchesQueue(value: unknown, order: string[]): value is FocusSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<FocusSession>;
  return Array.isArray(session.order)
    && session.order.length === order.length
    && session.order.every((id, index) => id === order[index])
    && typeof session.index === "number"
    && session.index >= 0
    && session.index <= order.length
    && session.results != null
    && typeof session.results === "object"
    && typeof session.actions === "number";
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user, org } = await requireOrgUser(request, env);

  // QBO-connected guard
  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  // Disconnected orgs can open Focus and see an empty deck instead of a bounce.

  const orgConfigForToday = await loadOrgConfig(supabase, org.org_id).catch(() => DEFAULT_ORG_CONFIG);
  const today = todayInTz(orgConfigForToday.companyProfile.timezone);

  const [src, { data: orgRow, error: orgErr }] = await Promise.all([
    loadCaseQueueSource({
      supabase, service, orgId: org.org_id, today, includePresence: true, orgConfig: orgConfigForToday,
    }),
    supabase.from("organizations").select("name").eq("id", org.org_id).single(),
  ]);
  if (orgErr) throw orgErr;
  const orgName = orgRow?.name ?? "";

  const allItems = buildCaseItems(
    src.cases, src.invoicesInput, src.customersInput,
    src.lastContactsInput, src.promisesInput, today, src.ownerLabels, src.orgConfig,
  );

  const built = buildFocusQueue(allItems, today, user.id);
  const nowMs = Date.now();
  const { queue, held } = dropLivePresenceCases(
    built.queue, src.presenceRows, user.id, nowMs,
  );
  const scope = built.scope;
  const heldLabels = held.map((h) => ({
    caseId: h.caseId,
    viewers: h.viewerIds.map((id) => src.ownerLabels.get(id) ?? "a teammate"),
  }));

  // Dashboard-parity collision per remaining case. Live viewers are already
  // dropped; recent-contact (RECENT_WINDOW_MIN) stays in the deck and must confirm.
  const presenceByCustomer = new Map<string, { userId: string; lastSeenAt: string }[]>();
  for (const r of src.presenceRows) {
    const list = presenceByCustomer.get(r.customer_id) ?? [];
    list.push({ userId: r.user_id, lastSeenAt: r.last_seen_at });
    presenceByCustomer.set(r.customer_id, list);
  }
  const collisions: Record<string, Collision> = {};
  for (const item of queue) {
    collisions[item.caseId] = collisionState({
      contacts: src.recentByCase.get(item.caseId) ?? [],
      heartbeats: presenceByCustomer.get(item.customerId) ?? [],
      currentUserId: user.id,
      nowMs,
      label: (id) => src.ownerLabels.get(id) ?? "A teammate",
    });
  }

  // Build timelines for every case in the queue (sliced to 5 recent entries).
  const caseIds = queue.map((c) => c.caseId);
  const timelines: Record<string, TimelineEntry[]> = {};
  let historyTruncated = src.lastContactTruncated;

  if (caseIds.length > 0) {
    type FocusLogRow = {
      id: string; case_id: string | null; user_id: string | null; method: string;
      outcome: string | null; notes: string | null; created_at: string;
      follow_up_at: string | null; promised_amount: number | string | null; promised_date: string | null;
    };
    type FocusMsgRow = {
      id: string; case_id: string | null; direction: string; body: string | null;
      status: string | null; error_code: string | null; created_at: string;
    };
    const chunks = chunkIds(caseIds, 100);
    const [logs, texts] = await Promise.all([
      pageAllChunked<FocusLogRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("contact_logs")
              .select("id, case_id, user_id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date", { count: "exact" })
              .eq("org_id", org.org_id)
              .in("case_id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
      pageAllChunked<FocusMsgRow>(
        chunks,
        (ids, from, to) =>
          orderPage(
            supabase
              .from("text_messages")
              .select("id, case_id, direction, body, status, error_code, created_at", { count: "exact" })
              .eq("org_id", org.org_id)
              .in("case_id", ids),
          ).range(from, to),
        { maxRows: PAGE_ALL_MAX_ROWS },
      ),
    ]);
    historyTruncated = historyTruncated || logs.truncated || texts.truncated;

    const logsByCase = new Map<string, TimelineLogInput[]>();
    const smsByCase = new Map<string, TimelineSmsInput[]>();

    for (const r of logs.rows) {
      if (!r.case_id) continue;
      const list = logsByCase.get(r.case_id) ?? [];
      list.push({
        id: r.id,
        at: r.created_at,
        method: r.method,
        outcome: r.outcome,
        notes: r.notes,
        followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
        authorLabel: r.user_id ? (src.ownerLabels.get(r.user_id) ?? null) : null,
      });
      logsByCase.set(r.case_id, list);
    }

    for (const r of texts.rows) {
      if (!r.case_id) continue;
      const list = smsByCase.get(r.case_id) ?? [];
      list.push({
        id: r.id,
        at: r.created_at,
        direction: r.direction,
        body: r.body,
        status: r.status,
        errorCode: r.error_code,
      });
      smsByCase.set(r.case_id, list);
    }

    for (const caseId of caseIds) {
      timelines[caseId] = buildTimeline(
        logsByCase.get(caseId) ?? [],
        smsByCase.get(caseId) ?? [],
      ).slice(0, 5);
    }
  }

  return data({
    queue: queue as CaseItem[],
    scope,
    heldLabels,
    collisions,
    timelines,
    smsEnabled: src.smsEnabled,
    smsQuietNow: src.smsQuietNow,
    quietHoursLabel: src.quietHoursLabel,
    lastContactTruncated: historyTruncated,
    currentUserId: user.id,
    today,
    smsTemplates: src.templates.sms,
    orgCompany: orgName,
    orgPhone: src.orgConfig.companyProfile.phone ?? "",
    orgPaymentLink: src.orgConfig.companyProfile.paymentPortalUrl ?? "",
    timeZone: src.orgConfig.companyProfile.timezone,
  }, { headers });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FocusMode() {
  const {
    queue, scope, heldLabels, collisions, timelines, smsEnabled, smsQuietNow, quietHoursLabel, today,
    smsTemplates, orgCompany, orgPhone, orgPaymentLink, timeZone, lastContactTruncated,
  } = useLoaderData<typeof loader>();

  // Session state
  const [session, dispatch] = useReducer(
    focusSessionReducer,
    queue.map((c) => c.caseId),
    initFocusSession,
  );
  const [sessionRestored, setSessionRestored] = useState(false);
  const restoreAttemptedRef = useRef(false);
  const restoreMismatchRef = useRef(false);

  // Restore after hydration so SSR markup remains deterministic. A session is
  // only reused when the queue order is identical to the saved session.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(FOCUS_SESSION_STORAGE_KEY);
        const saved = raw ? JSON.parse(raw) : null;
        if (sessionMatchesQueue(saved, queue.map((item) => item.caseId))) {
          dispatch({ type: "restore", session: saved });
        } else if (saved && typeof saved === "object") {
          // Keep the saved session until the user takes action in the new
          // queue; a fresh initial state must not overwrite it on mount.
          restoreMismatchRef.current = true;
        }
      } catch {
        // Private browsing or malformed prior state: start a fresh session.
      }
    }
    setSessionRestored(true);
  }, [queue]);

  useEffect(() => {
    if (!sessionRestored || typeof window === "undefined") return;
    if (restoreMismatchRef.current && session.actions === 0 && Object.keys(session.results).length === 0) return;
    try {
      window.localStorage.setItem(FOCUS_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Private browsing or storage quota: focus mode remains usable in memory.
    }
  }, [session, sessionRestored]);

  // Open mini-form
  const [openForm, setOpenForm] = useState<"call" | "text" | null>(null);

  // Toast messages
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((text: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Current case — must be declared before any effect that references it
  const currentId = session.order[session.index];
  const currentItem = currentId ? queue.find((c) => c.caseId === currentId) : null;
  const currentTimeline = currentId ? timelines[currentId] ?? [] : [];
  const done = isDone(session);

  // Snooze fetcher
  const snoozeFetcher = useFetcher();
  const snoozeHandledRef = useRef<unknown>(null);

  // Wait for server confirmation before advancing on snooze
  useEffect(() => {
    if (
      snoozeFetcher.data &&
      snoozeFetcher.data !== snoozeHandledRef.current &&
      typeof snoozeFetcher.data === "object" &&
      "ok" in snoozeFetcher.data
    ) {
      snoozeHandledRef.current = snoozeFetcher.data;
      if ((snoozeFetcher.data as { ok: boolean }).ok) {
        addToast(`Snoozed — follow up ${formatDate(currentItem?.suggestedFollowUpAt ?? null)}`);
        dispatch({ type: "resolve", result: "snoozed" });
      } else {
        const msg = (snoozeFetcher.data as { error?: string }).error ?? "Snooze failed";
        addToast(msg);
      }
    }
  }, [snoozeFetcher.data, addToast, currentItem?.suggestedFollowUpAt]);

  // Reset form when advancing
  useEffect(() => {
    setOpenForm(null);
  }, [session.index]);

  // If current case vanished after revalidation, auto-skip
  useEffect(() => {
    if (currentId && !currentItem && !done) {
      addToast("Case no longer available — skipping");
      dispatch({ type: "skip" });
    }
  }, [currentId, currentItem, done, addToast]);

  // Keyboard shortcuts
  const handleKey = useCallback((key: FocusKey) => {
    if (done || !currentItem) return;
    switch (key) {
      case "1":
        setOpenForm((prev) => prev === "call" ? null : "call");
        break;
      case "2":
        setOpenForm((prev) => prev === "text" ? null : "text");
        break;
      case "3": {
        // Snooze = log a follow-up-requested note (advance deferred to
        // the snooze confirmation effect — no optimistic dispatch).
        const fd = new FormData();
        fd.set("caseId", currentItem.caseId);
        fd.set("customerId", currentItem.customerId);
        fd.set("method", "note");
        fd.set("outcome", "follow-up-requested");
        fd.set("nextStep", "follow_up");
        fd.set("followUpAt", currentItem.suggestedFollowUpAt);
        fd.set("respond", "json");
        snoozeFetcher.submit(fd, { method: "post", action: "/api/contact-logs" });
        break;
      }
      case "space":
        dispatch({ type: "skip" });
        break;
      case "u":
        if (session.lastAction?.result === "skipped") {
          dispatch({ type: "undo" });
          addToast("Skip undone");
        }
        break;
    }
  }, [done, currentItem, snoozeFetcher, addToast, session.lastAction]);

  useFocusKeys({ enabled: openForm === null && !done && snoozeFetcher.state === "idle", onAction: handleKey });

  // Presence heartbeat for current case
  useEffect(() => {
    const cid = currentItem?.customerId ?? null;
    if (!cid) return;
    let cancelled = false;
    const beat = () => {
      const body = new FormData();
      body.set("customerId", cid);
      fetch("/api/presence/heartbeat", { method: "POST", body }).catch(() => {});
    };
    beat();
    const id = setInterval(() => {
      if (cancelled) return;
      beat();
    }, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [currentItem?.customerId]);

  // Progress
  const triaged = triageCount(session);
  const totalCount = session.order.length;
  const pct = totalCount > 0 ? (triaged / totalCount) * 100 : 0;

  return (
    <div className="flex min-h-screen flex-col bg-ink text-surface">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-3">
        <Link
          to="/dashboard"
          className="text-xs text-on-ink hover:text-surface flex items-center gap-1"
        >
          ← Exit
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-surface">NudgePay</span>
          <span className="rounded bg-copper/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-copper">
            Focus
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {session.lastAction?.result === "skipped" ? (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "undo" });
                addToast("Skip undone");
              }}
              className="rounded border border-copper/40 px-2 py-1 text-xs font-medium text-copper hover:bg-copper/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Undo skip <kbd className="ml-1 rounded border border-white/10 px-1 font-mono text-[10px]">u</kbd>
            </button>
          ) : null}
          <span className="font-mono text-xs text-muted">
            {triaged}/{totalCount} triaged
          </span>
          <div className="w-32 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-copper transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-xs text-copper font-semibold">
            {session.actions} {session.actions === 1 ? "action" : "actions"}
          </span>
        </div>
      </header>

      {/* Scope banner (fallback to all-open) */}
      {scope === "all-open" && totalCount > 0 && (
        <div className="border-b border-white/10 bg-warm/5 px-4 py-2 text-xs text-warm text-center">
          You own no cases — working the full open queue
        </div>
      )}
      {lastContactTruncated ? (
        <div className="border-b border-white/10 bg-copper/10 px-4 py-2 text-center">
          <span
            className="inline-flex items-center rounded-md border border-copper/20 px-2 py-0.5 text-[10px] font-sans font-medium text-copper"
            title="Based on the last 5,000 contact rows. Totals may under-count."
          >
            Partial history
          </span>
        </div>
      ) : null}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center px-4 py-8 gap-6">
        {done ? (
          /* Done state */
          <div className="mx-auto max-w-md text-center mt-16">
            <div className="text-5xl mb-4">✓</div>
            <h2 className="text-xl font-display font-bold text-surface mb-2">Queue cleared</h2>
            <p className="text-sm text-on-ink mb-1">
              {session.actions} {session.actions === 1 ? "action" : "actions"} taken across {triaged} {triaged === 1 ? "case" : "cases"}.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => dispatch({ type: "restart", order: queue.map((c) => c.caseId) })}
                className="rounded-lg border border-copper/40 px-4 py-2 text-sm font-semibold text-copper hover:bg-copper/10"
              >
                Start over
              </button>
              <Link
                to="/dashboard"
                className="rounded-lg bg-copper px-4 py-2 text-sm font-semibold text-surface hover:bg-copper/90"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        ) : totalCount === 0 ? (
          /* Empty queue */
          <div className="mx-auto max-w-md text-center mt-16">
            <h2 className="text-xl font-display font-bold text-surface mb-2">Nothing to triage</h2>
            <p className="text-sm text-on-ink mb-4">
              {heldLabels.length > 0
                ? `A teammate is already working ${heldLabels.length === 1 ? "this account" : "these accounts"} (${heldLabels.flatMap((h) => h.viewers).join(", ")}).`
                : "All cases are handled or on hold."}
            </p>
            <Link
              to="/dashboard"
              className="rounded-lg bg-copper px-4 py-2 text-sm font-semibold text-surface hover:bg-copper/90"
            >
              Back to dashboard
            </Link>
          </div>
        ) : currentItem ? (
          /* Active card + activity rail */
          <>
            <div className="flex-1 max-w-2xl">
              <FocusCard
                item={currentItem}
                whyNow={computeWhyNow(currentItem, timeZone)}
                index={session.index}
                total={totalCount}
                openForm={openForm}
                onAction={(action) => {
                  if (action === "snooze") {
                    handleKey("3");
                  } else {
                    setOpenForm((prev) => prev === action ? null : action);
                  }
                }}
                busy={snoozeFetcher.state !== "idle"}
                smsEnabled={smsEnabled}
                timeZone={timeZone}
              />

              {/* Mini-forms */}
              {openForm === "call" && (
                <LogCallMiniForm
                  item={currentItem}
                  collision={collisions[currentItem.caseId] ?? null}
                  onDone={() => dispatch({ type: "resolve", result: "logged" })}
                  onCancel={() => setOpenForm(null)}
                />
              )}
              {openForm === "text" && (
                <SendTextMiniForm
                  item={currentItem}
                  collision={collisions[currentItem.caseId] ?? null}
                  smsEnabled={smsEnabled}
                  smsQuietNow={smsQuietNow}
                  quietHoursLabel={quietHoursLabel}
                  onDone={() => dispatch({ type: "resolve", result: "texted" })}
                  onCancel={() => setOpenForm(null)}
                  onError={(code) => addToast(smsFlashCopy(code))}
                  smsTemplates={smsTemplates}
                  orgCompany={orgCompany}
                  orgPhone={orgPhone}
                  orgPaymentLink={orgPaymentLink}
                />
              )}
            </div>

            {/* Activity rail */}
            <aside className="hidden lg:block w-72 shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-muted/60 mb-2">
                Recent activity
              </p>
              {currentTimeline.length === 0 ? (
                <p className="text-xs text-muted">No activity yet</p>
              ) : (
                <div className="space-y-2">
                  {currentTimeline.map((entry) => (
                    <TimelineRow key={entry.id} entry={entry} timeZone={timeZone} />
                  ))}
                </div>
              )}
            </aside>
          </>
        ) : null}
      </main>

      {/* ── Key hint footer ──────────────────────────────────────────────── */}
      {!done && totalCount > 0 && (
        <footer className="border-t border-white/10 px-4 py-2 text-center text-[10px] text-muted/50 font-mono">
          <kbd className="px-1">1</kbd> log call · <kbd className="px-1">2</kbd> send text · <kbd className="px-1">3</kbd> snooze · <kbd className="px-1">space</kbd> skip · <kbd className="px-1">u</kbd> undo
        </footer>
      )}

      {/* ── Toasts ───────────────────────────────────────────────────────── */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border border-white/10 bg-ink/95 px-4 py-2 text-sm text-surface shadow-lg backdrop-blur pointer-events-auto animate-fade-in"
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Timeline row (compact) ──────────────────────────────────────────────────

function TimelineRow({ entry, timeZone }: { entry: TimelineEntry; timeZone?: string | null }) {
  const label = entry.kind === "log"
    ? (entry.outcomeLabel ?? OUTCOME_LABELS[entry.outcome ?? ""] ?? "Logged")
    : (OUTCOME_LABELS[entry.outcome] ?? "Text");
  const detail = entry.kind === "log"
    ? entry.notes
    : entry.body;
  const dateStr = formatInstant(entry.at, timeZone);
  const author = entry.kind === "log" ? entry.authorLabel : null;

  return (
    <div className="rounded border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-semibold text-surface">{label}</span>
        <span className="text-muted/60 font-mono text-[10px]">{dateStr}</span>
      </div>
      {detail && (
        <p className="text-muted line-clamp-2 leading-relaxed">{detail}</p>
      )}
      {author && (
        <p className="text-muted/50 text-[10px] mt-0.5">{author}</p>
      )}
    </div>
  );
}
