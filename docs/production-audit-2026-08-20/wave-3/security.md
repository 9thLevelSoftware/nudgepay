# Wave 3 — Adversarial security

- **Role:** Security Engineer
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/` (React Router 7.9.6 Framework Mode on Cloudflare Workers)
- **Date:** 2026-08-20
- **Scope:** code review only. No production probe, no product-code edits.
- **Live evidence:** n/a for every finding (no deployed origin was hit).

---

## What is solid

These controls were checked and should not be re-litigated as open holes.

| Control | Evidence | Why it holds |
|---|---|---|
| Webhook HMAC + empty-sig reject | `qbo-webhook.server.ts:24-36`, `twilio-webhook.server.ts:29-42`, `resend-webhook.server.ts:8-32`; routes `webhooks.qbo.tsx:16-20`, `webhooks.twilio.inbound.tsx:19-22`, `webhooks.twilio.status.tsx:17-20`, `webhooks.resend.tsx:11-16`; tests `webhooks-route.test.ts:9-26`, `twilio-routes.test.ts:10-30`, `resend-webhook.test.ts:37-38` | HMAC-SHA256 (QBO/Resend) / HMAC-SHA1 (Twilio-mandated). Custom XOR timing-safe compare. Missing header → `false` before any DB work. Resend also rejects stale timestamps (`> 5 min`). |
| AES-256-GCM for QBO tokens | `crypto.server.ts:16-44`, `qbo-connection.server.ts:5-15`, `tests/crypto.test.ts` | Web Crypto AES-GCM, random 12-byte IV, `v1:iv:ct` envelope, 32-byte key check, auth-tag failure on tamper. Tokens never written as plaintext. |
| OAuth user bind | `oauth-state.server.ts:12-34`, `auth.qbo.callback.tsx:24-31`, `0034_oauth_state_user_binding.sql` | 24-byte CSPRNG nonce, single-use delete-before-return, TTL, `user_id` NOT NULL. Callback requires `org.role === "owner" && org.org_id === oauthState.orgId && user.id === oauthState.userId`. Intuit GET disconnect does **not** clear tokens (`auth-flow.server.ts:22-27`, `api.qbo.disconnect.tsx:28-31`). |
| `safeReturnTo` | `return-to.ts:5-18`, `tests/return-to.test.ts` | Requires a single leading `/`, rejects `//`, backslash, and C0 controls. Every user-controlled **server** `redirect(returnTo)` goes through it (login/signup + all `api.*` actions that take `returnTo`). |
| Origin check on authenticated mutations | `csrf.server.ts:16-28`, `session.server.ts:26`, `tests/session.test.ts:111-159` | `requireUser` calls `requireSameOrigin` after auth. Missing Origin **and** Referer, or a foreign Origin, → 403. Fail-closed. |
| No `dangerouslySetInnerHTML` | repo-wide grep: **zero** matches in app source | Notes, templates, contact-log notes, inbound SMS bodies render as React text (`AccountProfile.tsx:209`, `DetailPanel.tsx:1128`, `MessageBubbles.tsx:27-29`). Stored XSS is not currently reachable via HTML injection. |
| App-layer IDOR on `api.*` | see mutation matrix | Every action that takes a client-supplied row id binds `.eq("org_id", org.org_id)` (or compares form `org_id` to `resolveOrg`) before write. Multi-org membership is not enough to touch the non-active org. |
| Composite tenant FKs | `0032_security_hardening.sql`, `0014_case_presence.sql:19`, `tests/rls.test.ts:124-145` | Child rows cannot pair org A’s `org_id` with org B’s case/customer/invoice id, even via service role. |

---

## Findings

### [TEMP-SEC-001]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** open
- **Evidence (code):** Zero matches for `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, or `X-Content-Type-Options` under `nudgepay-app/`. The Worker returns the React Router response unmodified:

```19:24:nudgepay-app/workers/app.ts
export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
```

`entry.server.tsx:38-42` sets only `Content-Type: text/html`. `root.tsx:38-53` emits no CSP `<meta>`. `wrangler.toml` has no `[env.production]` header transform. Google Fonts are loaded over HTTPS from third parties (`root.tsx:25-36`) with no policy constraining them.
- **Evidence (live):** n/a. Cloudflare zone-level Managed HTTPS / HSTS is **not** declared in-repo and must not be assumed.
- **User / legal impact:** Login and invite-accept can be framed (clickjacking). MIME sniffing is allowed. Referer may leak `/accept/<token>` or dashboard query strings to third-party origins (fonts.googleapis.com is already a third party on every page). Any future XSS (TEMP-SEC-007) has no CSP backup. Collections UIs that display debtor names/phones/balances are frameable by a malicious page.
- **Fix recipe:** In `workers/app.ts` wrap the RR response and set, at minimum: `Content-Security-Policy` (default-src 'self'; scripts/styles from the Worker + the fonts origins you actually use; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Apply to **all** responses, including webhook XML/JSON. Confirm the zone does not already emit conflicting copies.
- **Do not:** Rely on Cloudflare “Auto HTTPS” as a substitute for HSTS or CSP. Do not set `unsafe-inline` for scripts unless a nonce/hash migration is explicitly scoped.

---

### [TEMP-SEC-002]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** open
- **Evidence (code):** React Router 7.9.6 is in the GHSA-h5cw-625j-3rxh / CVE-2026-22030 affected range (`>= 7.0.0, <= 7.11.0`, patched in **7.12.0**). The app is Framework Mode with server `action` handlers (`package.json:22`, `app/routes.ts`). RR itself does not verify Origin on document POSTs.

Application mitigation for **authenticated** mutations:

```13:27:nudgepay-app/app/lib/session.server.ts
export async function requireUser(request: Request, env: AppEnv) {
  const { supabase, headers, user } = await getOptionalUser(request, env);
  if (!user) {
    // ... redirect to /login ...
    throw redirect(target, { headers });
  }
  requireSameOrigin(request, headers);
  return { supabase, headers, user: user as User };
}
```

```16:23:nudgepay-app/app/lib/csrf.server.ts
export function hasSameOriginProof(request: Request): boolean {
  if (!isUnsafeMethod(request.method)) return true;
  const expected = new URL(request.url).origin;
  const origin = originOf(request.headers.get("Origin"));
  if (origin) return origin === expected;
  const referer = originOf(request.headers.get("Referer"));
  return referer === expected;
}
```

`requireSameOrigin` **does** mitigate GHSA-h5cw-625j-3rxh for every route that calls `requireUser` / `requireOrgUser` on POST: a cross-site document POST with a foreign `Origin` is 403 (`tests/session.test.ts:143-159`). Combined with `@supabase/ssr` default `sameSite: "lax"` (`node_modules/@supabase/ssr/dist/module/utils/constants.js:1-8`), modern browsers also withhold the session cookie on cross-site POST.

Routes that **skip** `requireUser` (and therefore skip Origin checks):

| Route | File | Why it skips | CSRF standing |
|---|---|---|---|
| `POST /login` | `login.tsx:22-41` | public auth | **Login CSRF.** Attacker’s form posts attacker credentials to `/login`; the response `Set-Cookie` logs the victim into the attacker’s org. Victim may then connect QBO or paste notes into the attacker’s workspace. `SameSite=Lax` does not stop a **new** cookie from being set. |
| `POST /signup` | `signup.tsx:21-42` | public auth | Account-creation CSRF / email-confirmation spam. |
| `POST /logout` | `logout.tsx:5-9` | must work with a dying session | Cross-site POST typically does **not** send Lax cookies, so `signOut()` often no-ops (`removeItem` bails when `getAll` is empty). Residual if cookies ever become `SameSite=None`, or if a browser sends Lax cookies on that POST. GET `/logout` only redirects (`logout.tsx:12-14`) and does not sign out — good. |
| `POST /webhooks/*` | `webhooks.*.tsx` | provider callbacks | HMAC, not Origin. Correct skip. |
| `POST /unsubscribe` | `unsubscribe.tsx:21-36` | HMAC token is the capability | Cross-site POST with a stolen token opts that customer out. Equivalent to clicking the emailed link; RFC 8058-style. Acceptable. |

There is no synchronizer/double-submit CSRF token anywhere. Origin-then-Referer is the only app check, and it is not applied on login/signup/logout.
- **Evidence (live):** n/a. Attack sketch for login CSRF: attacker hosts `<form method="post" action="https://<app>/login">` with their email/password and auto-submits it in the victim’s browser.
- **User / legal impact:** Login CSRF can bind a victim’s subsequent QBO connect / invite-accept / note-taking to the attacker’s tenant. Logout CSRF is currently low-likelihood because of Lax cookies. Authenticated state-changing actions (SMS send, consent flip, settings) are Origin-checked **and** Lax-cookied — GHSA-h5cw is mitigated there, not eliminated at the framework layer.
- **Fix recipe:** (1) Upgrade `react-router` / `@react-router/dev` to **≥ 7.15.1** (see TEMP-SEC-007; 7.12.0 patches this GHSA but later GHSA-84g9 bypassed the new check on PUT/PATCH/DELETE). (2) Call `requireSameOrigin` on login, signup, and logout **before** `signIn`/`signUp`/`signOut`. (3) Keep the app-level Origin check even after the RR upgrade (defense in depth). (4) Do not add CSRF tokens to webhooks.
- **Do not:** Treat `SameSite=Lax` as the only CSRF control. Do not skip Origin checks on login because “the user isn’t authenticated yet.” Do not enable `SameSite=None` without a token.

---

### [TEMP-SEC-003]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** open
- **Evidence (code):** `createSupabaseUserClient` (`supabase.server.ts:5-30`) does not pass `cookieOptions`. `@supabase/ssr@0.12.0` therefore emits:

```1:8:nudgepay-app/node_modules/@supabase/ssr/dist/module/utils/constants.js
export const DEFAULT_COOKIE_OPTIONS = {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    // ...
    maxAge: 400 * 24 * 60 * 60,
};
```

No `secure: true`. Session payload is `base64url(JSON.stringify(session))` (`tests/session.test.ts:32-48`) — the JWT `access_token` is readable from `document.cookie`. `maxAge` is 400 days.
- **Evidence (live):** n/a. Confirm with `Set-Cookie` on `POST /login` after deploy.
- **User / legal impact:** Any XSS (TEMP-SEC-007, or a future app bug) can steal the session JWT from JavaScript and replay it against Supabase PostgREST (TEMP-SEC-008) and the Worker. Missing `Secure` allows the cookie to be written/sent on HTTP if the zone ever answers plain HTTP. 400-day sessions survive password resets only as far as Supabase invalidates refresh tokens — the cookie still presents a long-lived refresh token to XSS.
- **Fix recipe:** Pass `cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: <session TTL you actually want> }` into `createServerClient`. Prefer hours/days, not 400. After `httpOnly: true`, confirm the app has **no** client-side `supabase-js` browser client that needs to read the cookie (it does not today — all I/O is `.server.ts`).
- **Do not:** Set `httpOnly: true` while also shipping a browser Supabase client. Do not set `sameSite: "none"` to “fix” something.

---

### [TEMP-SEC-004]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** Repo-wide grep for `rateLimit` / `RateLimit` / `ratelimit` hits only `worker-configuration.d.ts` (Cloudflare type stubs). No binding in `wrangler.toml`. No application limiter on:

| Endpoint | File | Abuse |
|---|---|---|
| `POST /login` | `login.tsx:22-30` | credential stuffing; no backoff, no lockout |
| `POST /signup` | `signup.tsx:21-36` | account / confirm-email bomb |
| `POST /invite` | `invite.tsx:28-41` | invite-token spam (owner-gated, unbounded) |
| `POST /api/text/send` | `api.text.send.tsx:15-49` | per-invoice SMS, no per-user/org quota |
| `POST /api/email/send` | `api.email.send.tsx:8-32` | same for email |
| `POST /api/bulk-sms` | `api.bulk-sms.tsx:31-86` | batch is clamped by `smsBatchLimit` only; no daily cap |
| `POST /api/test-message` | `api.test-message.tsx:22-55` | owner can SMS **any** E.164 (`parseTestSmsDestination`); skips consent, quiet hours, and the ledger |
| `POST /api/presence/heartbeat` | `api.presence.heartbeat.tsx:8-25` | 20s poll from every open dashboard (`HEARTBEAT_MS`); no throttle |

`sendTestSms` (`test-message.server.ts:27-37`) is explicit: “no customer pipeline, no consent gates, no ledger inserts.”
- **Evidence (live):** n/a. Cloudflare WAF rate-limit rules are not in-repo.
- **User / legal impact:** A stolen member session can blast TCPA/CASL traffic (SMS) and CAN-SPAM traffic (email) until Twilio/Resend bills or a carrier complaint lands. Test-SMS is a one-click originator to arbitrary numbers. Login stuffing enumerates valid passwords against a collections dataset. Presence POSTs are a cheap Worker-invocation amplifier.
- **Fix recipe:** Bind a Cloudflare Rate Limiting / `ctx.env.RATE_LIMITER` (or Durable Object counter) keyed by `user.id` + route for send/invite/test-message, and by IP + email for login/signup. Cap test-SMS to the owner’s verified number. Keep `smsBatchLimit` as an inner clamp, not the only clamp. Log 429s.
- **Do not:** Rely on Twilio/Resend account-level caps as the product’s abuse control. Do not rate-limit webhooks (providers retry).

---

### [TEMP-SEC-005]
- **Severity:** minor
- **Bars:** polish
- **Area:** ops
- **Status:** open
- **Evidence (code):** Signature **verification** is solid (see “What is solid”). Replay is not:

| Provider | Timestamp / nonce | Replay effect |
|---|---|---|
| QBO | none (`qbo-webhook.server.ts:31-36`) | Re-delivery re-fetches live QBO entities (`webhooks.qbo.tsx:60-64`) and upserts. Functionally idempotent. Residual: a captured signed body can be replayed forever to trigger QBO API load / broken-promise alerts. |
| Twilio inbound | none (`twilio-webhook.server.ts:36-41`) | `text_messages_inbound_twilio_sid_key` (`0032_security_hardening.sql:102-103`) makes insert idempotent. |
| Twilio **status** | none | `updateMessageStatus` (`twilio-messaging.server.ts:261-268`) writes `status` / `error_code` with **no monotonic guard**. A captured `sent` callback replayed after `delivered` rewinds the row. |
| Resend | 5-minute window (`resend-webhook.server.ts:6, 30-32`) | Replay inside the window can re-apply a mapped status; outside → reject. No `svix-id` persistence. |

Empty signatures are rejected (tests cited above). Timing-safe compare returns early on length mismatch (`if (a.length !== b.length) return false`) — a theoretical timing oracle on HMAC length, not on the secret. Acceptable.
- **Evidence (live):** n/a.
- **User / legal impact:** Status rewind can hide a failed SMS from collectors (compliance display). QBO replay is cost/DoS against Intuit rate limits, not a tenant-cross write.
- **Fix recipe:** Persist provider event ids (`svix-id`, Twilio `MessageSid`+status, Intuit payload hash) with a TTL and drop duplicates. For Twilio status, only apply if the new status is forward on the Twilio lifecycle. Optionally reject QBO bodies older than N minutes if Intuit adds a timestamp you can verify inside the HMAC.
- **Do not:** Add Origin checks to webhooks. Do not switch Twilio off HMAC-SHA1 (provider-defined).

---

### [TEMP-SEC-006]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** tenancy
- **Status:** open
- **Evidence (code):** Service-role client is constructed on **user request paths**, not only cron/webhook:

1. **`listOrgMembers` enumerates the entire Auth directory.**

```78:91:nudgepay-app/app/lib/orgs.server.ts
export async function listOrgMembers(
  service: SupabaseClient,
  orgId: string,
): Promise<OrgMember[]> {
  const { data: rows, error } = await service
    .from("memberships").select("user_id").eq("org_id", orgId);
  // ...
  const { data: list, error: listErr } = await service.auth.admin.listUsers({ perPage: 1000 });
```

Called from dashboard/accounts/promises/messages/reports loaders and `case-queue.server.ts:148` — i.e. **every** authenticated page load. `orgId` is the caller’s org, then filtered in JS. The privileged call still materializes up to 1000 project users (emails, `user_metadata`) in the Worker. Orgs with members beyond the first 1000 **Auth** users silently drop them.

2. **`getConnectionStatus` / `last_sync_at` via service** — `qbo-connection.server.ts:18-24`, `workspace.server.ts:26-32`, `dashboard.tsx:169-193`, `focus.tsx:49-51`. After `0032` members already have `qbo_connections_member_read`. Service is unnecessary here. It does **not** decrypt tokens (good), but it bypasses RLS on a user-triggered path.

3. **Invite insert via service** — `invite.tsx:37-39`. Owner check is application-layer (`org.role !== "owner"`). `0032` already has `invites_owner_write`. A future bug in the role check is immediately an invite-token oracle because RLS is not in the path.

4. **Necessary service uses (not a defect, listed so they are not “fixed”):** QBO callback consume/store (`auth.qbo.callback.tsx:26-33` — `oauth_states` has RLS on and **no** policies, `0004_qbo_oauth.sql:8-10`); token encrypt/decrypt; Twilio/Resend/QBO webhooks; cron; `acceptInvite` membership insert; `createOrgForUser`; `sendInvoiceText` / `sendInvoiceEmail` (provider I/O + ledger under service, but invoice/customer loads are `.eq("org_id", args.orgId)`).
- **Evidence (live):** n/a.
- **User / legal impact:** Worker log leakage, a prototype-pollution RCE (TEMP-SEC-007), or a future unscoped `listUsers` change exposes **every** tenant’s email in the project, not just the caller’s org. Invite insert without RLS is a tenancy foot-gun. Connection-status service use is extra blast radius for no feature gain.
- **Fix recipe:** Replace `listUsers({ perPage: 1000 })` with `auth.admin.getUserById` per membership id (or a SECURITY DEFINER RPC that returns only that org’s emails). Point `getConnectionStatus` at the **user** client. Insert invites with the user client so `invites_owner_write` is the boundary. Keep service for oauth_states, crypto, providers, and cron.
- **Do not:** “Fix” this by passing the service client into more loaders. Do not log `list.users`.

---

### [TEMP-SEC-007]
- **Severity:** major
- **Bars:** P0-public
- **Area:** ops
- **Status:** open
- **Evidence (code):** Production dependency `react-router@7.9.6` and `@react-router/dev@7.9.6` (`package.json:22, 27`). Advisories that **include 7.9.6** (non-exhaustive; upgrade, don’t cherry-pick):

| Advisory | CWE | 7.9.6 | Patched | Notes vs this app |
|---|---|---|---|---|
| GHSA-h5cw-625j-3rxh / CVE-2026-22030 | CSRF on Framework `action` | vulnerable | 7.12.0 | Mitigated for `requireUser` POSTs (TEMP-SEC-002), not for login/signup/logout. |
| CVE-2026-53668 / GHSA-jjmj-jmhj-qwj2 | XSS via open redirect / `useNavigate` `//` and `:` | vulnerable (7.9.6–7.12.0) | 7.13.0 | App `safeReturnTo` blocks the usual server-side vector. Residual: any `Link`/`navigate`/`redirect` that skips the helper. |
| GHSA-8646-j5j9-6r62 | XSS `javascript:` redirect in **unstable RSC** | in range | 7.13.2 | App is Framework Mode, not unstable RSC. Low relevance, still an unpatched line. |
| GHSA-49rj-9fvp-4h2h | RCE **if** chained with prototype pollution | in range (7.5.2–7.14.1) | 7.14.2 | Not directly exploitable against RR alone. Still HIGH. |
| GHSA-f22v-gfqf-p8f3 | Stored XSS in prerendered redirect HTML | `@react-router/dev` 7.0–7.13.1 | 7.13.2 | Dev-time prerender path. |

January 2026 issues that **are** patched **in** 7.9.6 (CVE-2025-61686 path traversal, CVE-2025-68470 open redirect, meta() XSS fixed in 7.9.0) are not re-opened here.

No in-repo `npm audit` CI (Wave 0 freeze: `.github/` missing).
- **Evidence (live):** n/a.
- **User / legal impact:** Unpatched HIGH routing CVEs on the only public HTTP surface. CSRF/XSS in the framework plus `httpOnly: false` cookies (TEMP-SEC-003) and no CSP (TEMP-SEC-001) is a chain to session theft and tenant data.
- **Fix recipe:** Upgrade `react-router` and `@react-router/dev` together to the current 7.x security line (**≥ 7.15.1**, preferably current). Re-run `npm run typecheck` / `npx vitest run`. Keep `safeReturnTo` and `requireSameOrigin` after the upgrade. Add `npm audit --omit=dev` to CI.
- **Do not:** Stop at 7.12.0 (CSRF check later bypassed for PUT/PATCH/DELETE — GHSA-84g9). Do not copy a GitHub “patched in 7.9.6” bulletin as a reason to stay; later 2026 advisories re-opened 7.9.6.

---

### [TEMP-SEC-008]
- **Severity:** major
- **Bars:** P0-managed
- **Area:** compliance
- **Status:** open
- **Evidence (code):** Members who can present `anon key + user JWT` to PostgREST can **DELETE** audit rows in their org.

Grants:

```1:6:nudgepay-app/supabase/migrations/0002_rls_policies.sql
grant select, insert, update, delete on
  organizations, memberships, customers, invoices,
  contact_logs, text_messages, qbo_connections, messaging_config
to service_role, authenticated;
```

Default privileges (every later table):

```1:3:nudgepay-app/supabase/migrations/0001_tenancy_schema.sql
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
```

Policies still `FOR ALL` (SELECT/INSERT/UPDATE/**DELETE**) for members:

```31:34:nudgepay-app/supabase/migrations/0002_rls_policies.sql
create policy contact_logs_all on contact_logs
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy text_messages_all on text_messages
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
```

Same class, not tightened in `0032`:

- `collection_cases_all` — `0009_collection_cases.sql:24-25`
- `promises_all` / `promise_invoices_all` — `0010_promise_payment_loop.sql:27-28, 41-42`

Contrast: `email_messages` is member-read / owner-write (`0021_email_outbound.sql:26-29`); `customers` lost member DELETE in `0032` (`customers_owner_delete`). `contact_logs` / `text_messages` were left on the 0002 `FOR ALL` pattern.

Anon key is a Worker secret today (not bundled), but (a) the JWT lives in a **non-HttpOnly** cookie (TEMP-SEC-003), (b) Agents.md already records a **legacy hardcoded anon key in git history** that must be treated as public unless rotated, (c) PostgREST is the public Supabase URL. `DELETE /rest/v1/contact_logs?id=eq.<uuid>` with `Authorization: Bearer <jwt>` is then in-policy.
- **Evidence (live):** n/a. Attack: `DELETE https://<ref>.supabase.co/rest/v1/contact_logs?org_id=eq.<org>` with member JWT. RLS allows it; there is no app route that does this, which is irrelevant — PostgREST is the API.
- **User / legal impact:** A member (or XSS-stolen session) can wipe call notes, SMS bodies, and (same class) collection cases / promises. That is destruction of collections work-product and a record-keeping failure (FDCPA/state collection-agency record retention, TCPA consent/SMS logs). Cross-tenant DELETE is **not** in play — `is_org_member` still gates the row.
- **Fix recipe:** `REVOKE DELETE ON contact_logs, text_messages, collection_cases, promises, promise_invoices FROM authenticated;` then replace `FOR ALL` with `FOR SELECT` + `FOR INSERT` + (if needed) `FOR UPDATE`. Keep DELETE off authenticated entirely; hard-delete only via service/cron if ever. Add an RLS test that a member `delete()` returns an error and zero rows removed. Rotate the historical anon key.
- **Do not:** “Fix” this by hiding the Supabase URL. Do not add a client-side delete button that “isn’t in the UI.”

---

## IDOR notes (api.* — no open cross-tenant write)

Client-supplied ids are bound to `org.org_id` from `resolveOrg` (first membership). RLS alone is **not** treated as sufficient (comments in the routes call this out). None of the following are cross-tenant IDORs:

| Action | Client id | Pre-load `.eq("org_id")` | Update/insert also org-scoped |
|---|---|---|---|
| `api.contact-logs` | `caseId`, `invoiceId`, `customerId` | yes (`api.contact-logs.tsx:24-45`) | insert sets `org_id: org.org_id` |
| `api.assign` | `customerId`, `ownerId` | yes (`:21-22`); membership check (`:27-29`) | `.eq("org_id").eq("id")` |
| `api.account-notes` | `customerId` | yes (`:21-22`) | yes |
| `api.sms-consent` | `invoiceId` / `customerId` | yes (`:26-40`) | yes |
| `api.comm-prefs` | `customerId` / `caseId` / `invoiceId` | yes (`:46-68`) | yes |
| `api.priority-override` | `caseId` | yes (`:22-23`) | yes |
| `api.bulk-assign` | `caseIds`, `ownerId` | cases `.eq("org_id").in("id")` (`:47-48`); membership check | customers `.eq("org_id").in("id")` |
| `api.bulk-sms` | `caseIds` | `runBulkSms` `.eq("org_id").in("id")` (`bulk-send.server.ts:32-33`) | send path org-scoped |
| `api.promises.cancel` | `promiseId` | `cancelPromise` select `.eq("org_id")` (`promise-cancel.server.ts:16-19`) | yes |
| `api.text.send` / `api.email.send` | `invoiceId` | `sendInvoiceText` / `sendInvoiceEmail` `.eq("org_id").eq("id")` | ledger insert uses `args.orgId` |
| `api.sync-errors.dismiss` | `id` | **no pre-select** | update `.eq("org_id").eq("id")` (`:20-22`) — zero-row is silent, not cross-tenant |
| `api.notification-prefs` | form `org_id` | compared to `org.org_id` (`:17-19`) | upsert uses that org + `user.id` |
| `api.org-settings` | none (session org) | n/a | owner gate + `org.org_id` on every upsert/delete |
| `api.profile` | none | n/a | `auth.updateUser` self only |
| `api.presence.heartbeat` | `customerId` | **no pre-select** | upsert `org_id` + composite FK (`0014_case_presence.sql:19`) rejects cross-org ids; same-org junk ids can still insert a presence row |
| `api.qbo.*` / `api.test-message` | none | session org + owner where required | |

`resolveOrg` returns the **oldest** membership (`session.server.ts:34-41`). A multi-org user cannot pick the active org; they always mutate the first org. That is a product bug, not IDOR, but it means “dashboard org” is not a user-chosen tenant switch.

---

## Open redirects (residual only)

Server-side: every `form.get("returnTo")` is passed through `safeReturnTo`. Tests cover `//`, `https://`, `\`, and tab (`tests/return-to.test.ts:8-34`). `requireUser` encodes `pathname+search` onto `/login?returnTo=` (`session.server.ts:16-23`); login then re-validates (`login.tsx:37`).

`POST /api/qbo/connect` redirects to a **fixed** Intuit authorize URL (`qbo-client.server.ts:13-21`) with a server-minted `state`. Not user-controlled.

Client `Link to={returnTo}` (`LogContactDrawer.tsx:61, 68`) is fed parent-constructed `/dashboard?...` strings (`dashboard.tsx:644-661`), not the raw query. Residual risk is TEMP-SEC-007 (CVE-2026-53668) if a future caller passes an unsanitized string into `Link` / `navigate` / `redirect`.

---

## Stored XSS

No `dangerouslySetInnerHTML`. User-authored notes, template bodies, and inbound SMS/email bodies are React text nodes (`whitespace-pre-wrap` only). Email send uses Resend `text:` (`email-messaging.server.ts:61-63`), not attacker HTML. Test email HTML is a static string (`test-message.server.ts:78`). **No stored-XSS finding.** CSP (TEMP-SEC-001) is still required as defense in depth.

---

## Mutation matrix

CSRF column: `Origin` = `requireSameOrigin` via `requireUser`. `HMAC` = provider/token signature. `none` = no origin/token check.

| Endpoint | Method | Auth | CSRF | Org-scoped write | Service role | Rate limit |
|---|---|---|---|---|---|---|
| `/login` | POST | public | **none** | n/a (sets session) | no | **none** |
| `/signup` | POST | public | **none** | n/a | no | **none** |
| `/logout` | POST | cookie optional | **none** | n/a (clears session) | no | n/a |
| `/onboarding` | POST | user | Origin | creates org for `user.id` | **yes** (`createOrgForUser`) | **none** |
| `/invite` | POST | owner | Origin | `org.org_id` | **yes** (insert) | **none** |
| `/accept/:token` | POST | user | Origin | invite row via service; email match | **yes** (`acceptInvite`) | **none** |
| `/unsubscribe` | POST | HMAC token | token | token’s org+customer | **yes** | **none** (token is capability) |
| `/api/contact-logs` | POST | member | Origin | pre-load + insert `org_id` | no | **none** |
| `/api/assign` | POST | member | Origin | pre-load customer + member | no | **none** |
| `/api/bulk-assign` | POST | member | Origin | cases/customers org-scoped | no | batch clamp only |
| `/api/account-notes` | POST | member | Origin | pre-load customer | no | **none** |
| `/api/sms-consent` | POST | member | Origin | pre-load invoice/customer | no | **none** |
| `/api/comm-prefs` | POST | member | Origin | pre-load | no | **none** |
| `/api/priority-override` | POST | member | Origin | pre-load case | no | **none** |
| `/api/org-settings` | POST | **owner** | Origin | `org.org_id` | no | **none** |
| `/api/sync-errors/dismiss` | POST | member | Origin | update `.eq(org_id,id)` | no | **none** |
| `/api/promises/cancel` | POST | member | Origin | `cancelPromise` org-scoped | no | **none** |
| `/api/presence/heartbeat` | POST | member | Origin | upsert `org_id`; FK to customer | no (user client) | **none** |
| `/api/profile` | POST | member | Origin | self `updateUser` | no | **none** |
| `/api/notification-prefs` | POST | member | Origin | form org must equal session org | no | **none** |
| `/api/text/send` | POST | member | Origin | invoice `.eq(org_id)` | **yes** (Twilio + ledger) | **none** |
| `/api/email/send` | POST | member | Origin | invoice `.eq(org_id)` | **yes** (Resend + ledger) | **none** |
| `/api/bulk-sms` | POST | member | Origin | cases `.eq(org_id)` | **yes** | batch clamp only |
| `/api/test-message` | POST | **owner** | Origin | org sender; **arbitrary `to`** | **yes** | **none** |
| `/api/qbo/connect` | POST | **owner** | Origin | oauth_states for `org.org_id`+`user.id` | **yes** | **none** |
| `/api/qbo/disconnect` | POST | **owner** | Origin | `eq(org_id)` | **yes** | **none** |
| `/api/qbo/refresh` | POST | member | Origin | sync `org.org_id` | **yes** | **none** |
| `/auth/qbo/callback` | GET | user + nonce | OAuth state (not CSRF) | user/org bind | **yes** | n/a |
| `/webhooks/qbo` | POST | HMAC | HMAC | realm → org lookup | **yes** | n/a (provider) |
| `/webhooks/twilio/inbound` | POST | HMAC | HMAC | phone match | **yes** | n/a |
| `/webhooks/twilio/status` | POST | HMAC | HMAC | MessageSid | **yes** | n/a |
| `/webhooks/resend` | POST | HMAC + 5m | HMAC | mapped ids | **yes** | n/a |

GET `/api/qbo/disconnect` is a confirmation page only (`intuitDisconnectPlan` always `{ clear: false }`). Not a mutation.

---

## Priority order

1. TEMP-SEC-007 — upgrade `react-router` off 7.9.6.
2. TEMP-SEC-008 — revoke authenticated DELETE on audit tables; rotate historical anon key.
3. TEMP-SEC-001 — security headers on the Worker.
4. TEMP-SEC-003 — `httpOnly` + `Secure` cookies.
5. TEMP-SEC-002 — Origin check on login/signup/logout (after or with the RR upgrade).
6. TEMP-SEC-004 — rate limits on send/login/invite/test-message.
7. TEMP-SEC-006 — stop `listUsers({ perPage: 1000 })` on the dashboard path; drop unnecessary service reads.
8. TEMP-SEC-005 — Twilio status monotonicity / event-id replay cache.
