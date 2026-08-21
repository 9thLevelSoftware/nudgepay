# Wave 1 — Auth / session / identity

- **Auditor:** Security Engineer
- **HEAD:** `820fb1ba035f96d1470ca3b8a2bf4a73b62245bc`
- **App:** `nudgepay-app/`
- **Date:** 2026-08-20
- **Live env:** none (freeze: `.env.test` missing, no production Worker). All **Evidence (live):** n/a.
- **Prior audit:** `docs/codebase-audit-2026-07-13.md` (B0, M1–M5, minors 1/39/40/43/44/52). Reconfirmed against this HEAD; IDs in **Status**.

Scope: login, signup, logout, onboarding, invite, accept, profile, `session.server.ts` (oldest-membership `resolveOrg`), `auth-flow.server.ts`, `return-to.ts`, `csrf.server.ts`, Supabase cookie adapter, `oauth-state.server.ts`, QBO callback user binding, memberships RLS, roster labels.

---

## Verdict

| Severity | Count | IDs |
|---|---|---|
| blocker | 4 | 001, 002, 006, 012 |
| major | 6 | 003, 004, 007, 010, 011, 013 |
| minor | 5 | 005, 008, 009, 014, 015 |

Public launch is not viable: there is no password recovery, no email-confirm landing (production path assumed ON in code comments), session cookies are JS-readable for 400 days, and a terminated member cannot be removed. A managed Chancey-style launch still hits **012** (offboarding) and, if hosted confirmations are ON, **002** (nobody finishes signup).

---

## Findings

### [TEMP-AUTH-001] No password reset / forgot-password flow
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior B0)
- **Evidence (code):** `nudgepay-app/app/routes.ts:1-47` (no recovery/reset/confirm route); `nudgepay-app/app/routes/login.tsx:80-88` (password field, no “forgot password” link); repo-wide grep for `resetPasswordForEmail` / `forgot` / `recovery` in `app/` and `tests/` returns nothing. `api.profile.tsx` is the only `updateUser` call and it writes `display_name` only (`nudgepay-app/app/routes/api.profile.tsx:21-23`).
- **Evidence (live):** n/a
- **User / legal impact:** A collections user who forgets their password is locked out of customer AR, SMS, and QBO-linked data with no self-serve path. Operator can reset in Supabase Studio for a managed tenant (so this is not a P0-managed blocker), but a public user has no recourse except emailing `support@nudgepay-ar.app`. Combined with **006**, a compromised password cannot be rotated by the user either.
- **Fix recipe:**
  1. files: add `app/routes/forgot-password.tsx` + `app/routes/auth.confirm.tsx` (shared with **002**); register both in `app/routes.ts`; add a link on `login.tsx`.
  2. behavior: `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + "/auth/confirm?next=/reset-password" })`; confirm route `verifyOtp({ type: "recovery", token_hash })` then a POST that calls `updateUser({ password })` behind `requireUser` + `requireSameOrigin`. Same generic success copy whether or not the email exists.
  3. tests to add: `tests/auth-reset.test.ts` — unknown email does not change copy/timing; recovery token exchange sets session cookies; open-redirect `redirectTo` rejected; CSRF on the new-password POST.
  4. manual verify: request reset, click mail, set new password, old password fails, session on other browsers revoked if refresh-token rotation is on.
- **Do not:** ship a “reset” page that calls `updateUser({ password })` without a recovery session; echo “no user with that email”; point `redirectTo` at an unlisted URL (GoTrue will refuse, user lands nowhere).

### [TEMP-AUTH-002] No `/auth/confirm` landing; signup confirm branch drops `Set-Cookie`
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior M1)
- **Evidence (code):** `nudgepay-app/app/routes.ts` has `signup`/`login`/`logout` but no `auth/confirm`. `nudgepay-app/app/lib/auth-flow.server.ts:6-16` documents production confirmations ON → `session` is null → do not redirect to an auth-gated page. `nudgepay-app/app/routes/signup.tsx:39-41` follows that, then **returns a plain object** `{ confirmEmail, returnTo }` and drops the `headers` bag from `createSupabaseUserClient` (line 31). `createServerClient` is PKCE with `detectSessionInUrl: false` (`nudgepay-app/node_modules/@supabase/ssr/src/createServerClient.ts:153-155`); there is no browser Supabase client in `app/` (only `createSupabaseUserClient` / service client in `supabase.server.ts`). Local `enable_confirmations = false` (`nudgepay-app/supabase/config.toml:226`) hides this in dev; `site_url = "http://127.0.0.1:3000"` (`config.toml:159`) is the email redirect target, which is `home.tsx` (marketing, no token exchange).
- **Evidence (live):** n/a
- **User / legal impact:** If hosted GoTrue has confirmations ON (what the code comments treat as production), clicking the confirmation email lands the user on `/` unsigned-in. Invite `returnTo` survives only on the “check your email → sign in” link (`signup.tsx:51-53`), not on the mail click, so invitees typically hit `/onboarding` after they finally log in (**010** + **011**) instead of `/accept/:token`. If confirmations are OFF in production, anyone can create an org with an unproven email. Either setting is a launch defect.
- **Fix recipe:**
  1. files: `app/routes/auth.confirm.tsx` + `app/routes.ts`; keep `signupOutcome` but return `data({ confirmEmail, returnTo }, { headers })` so PKCE/session cookies are not dropped; set hosted `site_url` / `additional_redirect_urls` to `https://<prod>/auth/confirm`.
  2. behavior: GET `/auth/confirm?token_hash=&type=` → `verifyOtp` → redirect to `safeReturnTo(next)` or `/onboarding`. Support `type=signup|email|recovery`. Never render tokens in HTML.
  3. tests to add: confirm with valid hash sets `Set-Cookie` and honors `next=/accept/<token>`; invalid/expired hash is a generic error; confirm branch of signup **includes** `Set-Cookie` even when `session` is null; `signupOutcome(false, "/accept/x")` still used for the check-email UI.
  4. manual verify: hosted project with confirmations ON, sign up with `returnTo=/accept/<token>`, click mail, land signed-in on accept (not marketing, not a second org).
- **Do not:** turn confirmations OFF in production as the “fix”; consume tokens in a client `useEffect` (this app is SSR, `detectSessionInUrl` is off); drop `headers` on the confirm-email JSON response.

### [TEMP-AUTH-003] Auth cookies are not HttpOnly, not Secure, max-age 400 days
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** open
- **Evidence (code):** `nudgepay-app/app/lib/supabase.server.ts:5-30` calls `createServerClient` with **no** `cookieOptions`. Library defaults (`nudgepay-app/node_modules/@supabase/ssr/src/utils/constants.ts:3-10`): `path: "/"`, `sameSite: "lax"`, **`httpOnly: false`**, `maxAge: 400 * 24 * 60 * 60`, **no `secure`**. `serializeCookieHeader` passes those options through (`@supabase/ssr/src/utils/helpers.ts:41-47`). Cookie value is the full persisted session (access + refresh JWT) under `sb-<ref>-auth-token`. There is no browser `createBrowserClient` that would justify a JS-readable cookie. `[auth.sessions]` timebox / inactivity_timeout are commented out (`config.toml:272-276`).
- **Evidence (live):** n/a
- **User / legal impact:** Any XSS (or a malicious browser extension) can read the refresh token from `document.cookie` and hijack the session for up to 400 days. Missing `Secure` lets the same cookie travel on HTTP if the Worker origin is ever hit without TLS. This is session theft of an app that holds customer invoices, phones, and the ability to send dunning SMS/email.
- **Fix recipe:**
  1. files: `app/lib/supabase.server.ts` — pass `cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: <product TTL> }`.
  2. behavior: session cookie must not appear in `document.cookie`; `Secure` set in production; consider a 7–30d max-age plus GoTrue inactivity timeout. Keep Lax (needed for top-level OAuth return).
  3. tests to add: after `signInWithPassword`, capture `Set-Cookie` and assert `HttpOnly`, `Secure`, `SameSite=Lax`; a document-cookie simulation cannot read the name.
  4. manual verify: DevTools Application → cookies on a staging HTTPS origin.
- **Do not:** set `sameSite: "none"` to “make OAuth work” (QBO return is a GET to `/auth/qbo/callback`, Lax is enough); copy-paste browser-client defaults; set `secure: true` only in local HTTP without a prod branch (break local, ship HTTP in prod, or vice versa — branch on `request.url` protocol).

### [TEMP-AUTH-004] Login and signup skip same-origin CSRF; login CSRF + `returnTo` swaps the session
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior minor 39, split: login/signup vs logout)
- **Evidence (code):** `requireSameOrigin` runs only inside `requireUser` **after** a user is present (`session.server.ts:13-27`). `login.tsx:22-41` and `signup.tsx:21-41` call `createSupabaseUserClient` + `signInWithPassword` / `signUp` with no Origin/Referer check. Login honors attacker-controlled `returnTo` **before** `resolveOrg` (`login.tsx:35-38`, hidden field at line 76). `safeReturnTo` (`return-to.ts:5-18`) correctly rejects `//`, `\`, and controls — this is **not** an open redirect — but it still allows any same-origin path. Logout/login CSRF is not covered by `tests/session.test.ts` (those tests only hit `requireUser`). `sameSite: "lax"` does **not** stop a **top-level** cross-site POST from receiving first-party `Set-Cookie` (classic login CSRF).
- **Evidence (live):** n/a
- **User / legal impact:** An attacker page can auto-POST attacker credentials to `/login` (optionally with `returnTo=/settings` or `/api/qbo/connect` is GET-redirected so it will not fire, but `/dashboard` / settings will). The victim’s browser is now in the attacker’s NudgePay org. If they then click **Connect QuickBooks**, Intuit tokens bind to the attacker’s `org_id` (callback *does* bind user+org — **solid** — but the user *is* the attacker’s session). Same pattern on signup when confirmations are OFF (`signupOutcome(true)` redirects with session cookies).
- **Fix recipe:**
  1. files: `login.tsx`, `signup.tsx`, `csrf.server.ts` — call `requireSameOrigin(request)` at the top of both actions (before `signIn`/`signUp`). Optionally issue a CSRF cookie+field for defense in depth.
  2. behavior: cross-origin POST → 403, no `Set-Cookie`. Keep `safeReturnTo`. If already signed in, either no-op redirect to dashboard/returnTo or require explicit “switch account”.
  3. tests to add: POST `/login` with `Origin: https://evil.example` does not set session cookies; same-origin Origin succeeds; `returnTo=https://evil` and `returnTo=//evil` fall through to org routing.
  4. manual verify: HTML form on another origin posting to staging `/login` must 403.
- **Do not:** remove `returnTo` (breaks invite accept); rely on SameSite=Lax as sufficient for **login** CSRF; validate Origin only when a session already exists.

### [TEMP-AUTH-005] Logout POST is not origin-checked
- **Severity:** minor
- **Bars:** polish
- **Area:** auth
- **Status:** reconfirmed (prior minor 39, logout half)
- **Evidence (code):** `nudgepay-app/app/routes/logout.tsx:5-9` builds a user client and `signOut()` with no `requireUser` / `requireSameOrigin`. GET loader (`logout.tsx:12-14`) only redirects to `/login` and does **not** sign out (correct). UI is a POST from `AppShell.tsx:154-163`. Lax cookies (`constants.ts:5`) mean a cross-site POST will **not** send the session cookie, so this is largely mitigated if **003** keeps `sameSite: "lax"`.
- **Evidence (live):** n/a
- **User / legal impact:** Nuisance logout if cookie flags regress (`SameSite=None` / older browsers). Avatar-as-logout (`AppShell.tsx:154`) also means one misclick signs the user out of a collections session (prior minor 3; UX, not CSRF).
- **Fix recipe:**
  1. files: `logout.tsx` — `requireSameOrigin` (use `getOptionalUser` then origin check so unauthenticated POST still 403/redirect cleanly).
  2. behavior: foreign-origin POST does not clear cookies; GET remains non-mutating.
  3. tests to add: POST `/logout` without Origin → 403 and session cookie still present; with matching Origin → 302 `/login` and `Set-Cookie` max-age 0.
  4. manual verify: cross-origin form POST to `/logout` leaves you signed in.
- **Do not:** protect logout by converting it to GET (that *would* fire under Lax via a simple link); skip the Origin check because “Lax is enough” without a test that locks SameSite.

### [TEMP-AUTH-006] No change-password, change-email, or account deletion
- **Severity:** blocker
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior M5; related minor 43)
- **Evidence (code):** Only `auth.updateUser` in product code is `api.profile.tsx:21-23` (`data: { display_name }`). Settings profile section is display-name only (`settings.tsx:178-199`). `privacy.tsx:52-54`: “To request deletion of your other stored data, contact support@nudgepay-ar.app.” Several `auth.users` FKs have **no** `ON DELETE` (`contact_logs.user_id` at `0001_tenancy_schema.sql:73`; `text_messages.sent_by_user_id` at `0001:86`) so even an operator `admin.deleteUser` fails once the user has logged activity. `secure_password_change = false` (`config.toml:228`).
- **Evidence (live):** n/a
- **User / legal impact:** Users cannot rotate a leaked password, cannot leave a shared-email situation, and cannot exercise deletion without a support ticket that the schema will then refuse. Florida operator + customer PII (names, phones, invoices) makes “email us” a weak privacy posture for a public launch. Managed Chancey can use Studio + SQL, so not P0-managed, but public/self-serve is blocked.
- **Fix recipe:**
  1. files: settings “Account” section; `api.profile.tsx` or new `api.account.tsx`; migrations to add `ON DELETE SET NULL` (or RESTRICT with an explicit anonymize path) on actor FKs; confirm route from **001**/**002**.
  2. behavior: change password requires current password (`reauthenticate`); change email uses GoTrue double-confirm (`config.toml:224`); delete is owner-gated, last-owner must delete/transfer org, then `admin.deleteUser` after anonymizing logs.
  3. tests to add: password change rejects wrong current password; email change does not succeed without confirm; delete of a user with contact_logs succeeds or is a clean 409 with instructions; CSRF on all three.
  4. manual verify: walk each flow on staging; confirm privacy copy matches the button.
- **Do not:** call `admin.deleteUser` from a user-client action; `updateUser({ email })` without confirm; leave actor FKs as bare uuids and hope Studio delete works.

### [TEMP-AUTH-007] Invites never send email; copy-link is a relative path; page is unlinkable
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior M2)
- **Evidence (code):** `invite.tsx:38-41` inserts via service role and returns `{ ok, link: "/accept/" + token }` — no Resend/GoTrue invite call. UI renders that relative path in `<code>` (`invite.tsx:51-54`) with no origin, no copy control. Submit button idle copy is “Send invite”, busy copy **“Sending invite…”** (`invite.tsx:60`) despite sending nothing. `/invite` is registered (`routes.ts:9`) but **no** `Link`/`href` to `/invite` exists in `app/components/` or `settings.tsx` (only `routes.ts` + `invite.tsx`). Owner gate **is** enforced (see Solid). 14-day expiry **is** enforced (see Solid).
- **Evidence (live):** n/a
- **User / legal impact:** Team onboarding is a hidden developer URL. Owners who find it get a path that does not work when pasted into chat without the production origin. Invitees never receive mail. For a managed operator who knows `/invite` this is a procedure, not a product; public self-serve orgs cannot add the AR team.
- **Fix recipe:**
  1. files: `invite.tsx`, Settings → Workspace, `notifications.server.ts` / Resend template, `orgs.server.ts`.
  2. behavior: insert invite (unique pending — **008**), send email with **absolute** `APP_PUBLIC_BASE_URL + /accept/<token>`, show “Invite sent to X (expires …)” plus a copy-absolute-link fallback; add an Invites entry for owners on Settings; change busy copy to “Creating invite…”.
  3. tests to add: action does not return `error.message` from PostgREST (**009**); email send invoked with absolute URL; member role 403; unauthenticated 302 `/login`.
  4. manual verify: owner in Settings can invite; mail arrives; link works signed-out (login `returnTo`) and signed-in.
- **Do not:** email the raw token without `/accept/`; use `request.url` origin behind a proxy without `APP_PUBLIC_BASE_URL`; “fix” by only adding a copy button and leaving the page unlinked.

### [TEMP-AUTH-008] Unlimited duplicate pending invites per (org, email)
- **Severity:** minor
- **Bars:** polish
- **Area:** auth
- **Status:** reconfirmed (prior minor 44)
- **Evidence (code):** `0003_invites.sql:1-7` — `email text not null`, unique only on `token`. `0032_security_hardening.sql` adds `expires_at` and an owner write policy, **not** a unique index. `invite.tsx:38-39` inserts every click. Accepting one row stamps that id (`orgs.server.ts:29-30`); sibling tokens for the same email remain valid until their own `expires_at`.
- **Evidence (live):** n/a
- **User / legal impact:** Double-click produces two live tokens. A leaked older token still admits the invitee (email match still required). Operational noise, not a tenancy bypass.
- **Fix recipe:**
  1. files: new migration `unique (org_id, lower(email)) where accepted_at is null`; `invite.tsx` to upsert/reuse.
  2. behavior: second invite for the same pending email rotates token + `expires_at` (or returns the existing link).
  3. tests to add: two inserts → one pending row; accept consumes that row only.
  4. manual verify: mash “Send invite” twice, one token works, the other 404s.
- **Do not:** unique on `(org_id, email)` including accepted rows (blocks re-invite after a leave that **012** will add); compare emails case-sensitively.

### [TEMP-AUTH-009] Invite action returns raw PostgREST errors
- **Severity:** minor
- **Bars:** polish
- **Area:** auth
- **Status:** reconfirmed (prior minor 40)
- **Evidence (code):** `invite.tsx:40` — `if (error) return { error: error.message };`. Contrast: login/signup map through `humanAuthError` (`auth-flow.server.ts:39-41`) so unmapped strings become “Something went wrong.”
- **Evidence (live):** n/a
- **User / legal impact:** Constraint names, column names, and FK failures can render in the owner UI (`role="alert"` at `invite.tsx:50`). Helps an attacker map schema; looks broken to the owner.
- **Fix recipe:**
  1. files: `invite.tsx` (and `accept.$token.tsx:58`, which also returns `(e as Error).message`).
  2. behavior: log `error` server-side; client sees a stable code (`invite-failed`, `invite-duplicate`).
  3. tests to add: forced insert error → body does not contain `invites` / `org_id`.
  4. manual verify: break the insert (e.g. invalid email column) and confirm the alert is generic.
- **Do not:** `String(error)` the whole PostgREST object; map only `23505` and let every other code through.

### [TEMP-AUTH-010] Onboarding action does not re-check membership — replay creates extra orgs
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior minor 1; raised: compounds **002** + **011**)
- **Evidence (code):** Loader redirects if `resolveOrg` is non-null (`onboarding.tsx:23-24`). Action (`onboarding.tsx:28-37`) calls `requireUser` then `createOrgForUser` with **no** `resolveOrg`. `createOrgForUser` (`orgs.server.ts:35-49`) always `INSERT organizations` + owner membership; unique is `(org_id, user_id)` not `(user_id)`, so a second org succeeds. Compensation delete only runs if the **membership** insert fails (`orgs.server.ts:46-48`), which it will not on replay. CSRF is checked (via `requireUser`), so this is same-origin double-submit / invitee self-onboarding, not cross-site.
- **Evidence (live):** n/a
- **User / legal impact:** Double-click or a confirmation-broken invitee (**002**: mail click loses `returnTo`, login has no org → `/onboarding`) creates a personal org. `resolveOrg` then permanently selects that oldest org (**011**). The invited workspace is joined but never shown. Operator sees “empty dashboard / no QBO” tickets; extra orgs pile up with the user as owner.
- **Fix recipe:**
  1. files: `onboarding.tsx` action; `createOrgForUser` in `orgs.server.ts`.
  2. behavior: action re-`resolveOrg` and redirect if any membership exists; optionally refuse `createOrgForUser` unless `memberships` for `user_id` is empty (product decision: single-org vs switcher — **011**). Idempotent: treat unique/replay as success of the existing org.
  3. tests to add: two POSTs → one `organizations` row; user who already has a membership is 302 `/dashboard` and row count unchanged.
  4. manual verify: double-click “Create organization”; invitee with confirmations ON still lands on `/accept/:token` not a new org.
- **Do not:** add a unique `(user_id)` on memberships without an org switcher and a migration for existing doubles; delete “extra” orgs that already have invoices.

### [TEMP-AUTH-011] `resolveOrg` always picks the oldest membership; no org switcher
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior M3)
- **Evidence (code):** `session.server.ts:30-41` — `.order("created_at", { ascending: true }).limit(1)`. Used by `requireOrgUser` (`session.server.ts:48-52`) and therefore `loadWorkspaceChrome` (`workspace.server.ts:19`). Grep for switcher / `currentOrg` / `activeOrg` in `app/` is empty. Accept still inserts a second membership (`orgs.server.ts:24-27`, 23505 treated as success) then `redirect("/dashboard")` (`accept.$token.tsx:60`) of the **old** org. Accept UI reports success (“Join {org}?”) with no warning.
- **Evidence (live):** n/a
- **User / legal impact:** A bookkeeper who is invited to a second company, or an invitee who onboarded first (**010**), works in the wrong tenant indefinitely: wrong invoices, wrong SMS sender context, wrong QBO connect. They cannot leave (**012**) or switch. Silent data-plane mix-up, not a cross-tenant RLS hole (RLS still keys off the selected `org_id`).
- **Fix recipe:**
  1. files: `session.server.ts`; chrome/settings; accept action.
  2. behavior (pick one and test it): **(A)** single-org product — `acceptInvite` refuses if the user already has a membership, onboarding refuses if any membership exists; **(B)** multi-org — persist `org_id` in a separate HttpOnly cookie, add a switcher, pass that id into `requireOrgUser` (still RLS-checked).
  3. tests to add: two memberships → documented selection; accept-while-owner either errors or switches; cookie tampering to another org_id is ignored unless a membership row exists.
  4. manual verify: owner accepts a second invite and sees that org (B) or a clear error (A).
- **Do not:** store selected `org_id` only in the client and trust it without a membership lookup; “fix” by `order created_at desc` (still a trap, just the other org).

### [TEMP-AUTH-012] No member removal, role change, leave-org, or memberships DELETE policy
- **Severity:** blocker
- **Bars:** P0-managed
- **Area:** auth
- **Status:** reconfirmed (prior M4)
- **Evidence (code):** `0002_rls_policies.sql:22-24` — `mem_select` only (`for select using (is_org_member(org_id))`). No later migration adds INSERT/UPDATE/DELETE policies on `memberships` (confirmed across `0001`–`0034`). `GRANT ... delete on memberships` exists (`0002:3-6`) but RLS default-deny makes it a no-op for `authenticated`. No route/API/UI for remove, role, leave, or revoke-invite (`routes.ts` has no members resource). `acceptInvite` always inserts `role: "member"` (`orgs.server.ts:25`). Role check for owners is `org.role !== "owner"` on invite/QBO only.
- **Evidence (live):** n/a
- **User / legal impact:** A terminated AR employee keeps login, the oldest-org dashboard, customer phones, invoice balances, and the ability to send SMS/email until someone deletes the auth user in Studio **and** wins the FK fight (**006**). This is an access-control failure for **any** real tenant, including a 5-person Chancey rollout. Public SaaS cannot ship without it either; P0-managed is the tighter launch bar.
- **Fix recipe:**
  1. files: migration `mem_owner_delete` / `mem_self_delete` (cannot delete last owner); `api.members.tsx`; Settings roster; invite revoke (`accepted_at` or `revoked_at`).
  2. behavior: owner can remove members and change `member`↔`owner` with a last-owner guard; member can leave; all via service or new RLS, still `requireSameOrigin`. Removing a member must not orphan `contact_logs` (SET NULL).
  3. tests to add: `*-rls.test.ts` — member cannot DELETE others; owner can; last owner cannot leave; user client still cannot INSERT a self-membership.
  4. manual verify: offboard a user, confirm 302 `/login` or empty onboarding, SMS as that user 403s.
- **Do not:** add a blanket `for all using (is_org_member)` on `memberships` (any member could promote themselves or drop the owner); delete `auth.users` from the app with the current FKs.

### [TEMP-AUTH-013] `listOrgMembers` reads only the first 1,000 auth users project-wide
- **Severity:** major
- **Bars:** P0-public
- **Area:** auth
- **Status:** reconfirmed (prior minor 52; raised: helpers already page, production does not)
- **Evidence (code):** `orgs.server.ts:88` — `service.auth.admin.listUsers({ perPage: 1000 })` with **no page loop**. Roster is `memberships` ∩ that map (`orgs.server.ts:82-97`); missing users become `displayLabel(undefined, "", userId)` → 8-char id (`names.ts:10-18`). Used by dashboard chrome/assign (`case-queue.server.ts:148`), accounts, promises, messages, reports. Test helper **already** pages (`tests/helpers.ts:21-34`, comment: GoTrue defaults to 50/page and a single page misses users) — production roster did not get the same fix.
- **Evidence (live):** n/a
- **User / legal impact:** Labels, owner assignment, reports, and notification targeting silently degrade once the **project** (all tenants) exceeds 1,000 auth users — or earlier if `perPage` is capped below 1000 on hosted GoTrue. Wrong names on collection activity is a trust/compliance issue; missing members in assign pickers look like data loss. Five-user managed tenants will not hit this (polish there); public multi-tenant will.
- **Fix recipe:**
  1. files: `orgs.server.ts` — look up **member ids only** (`auth.admin.getUserById` in a bounded pool, or `in('id', memberIds)` if/when supported), never a global `listUsers`.
  2. behavior: every membership row gets a label; empty metadata falls back per `displayLabel`.
  3. tests to add: stub `listUsers` returning a page that omits a member → current code fails, fixed code still labels them; keep `tests/orgs.test.ts` roster assertions.
  4. manual verify: n/a at 5 users; add a staging fixture > page size.
- **Do not:** raise `perPage` and call it done; filter `listUsers` in memory and assume one page is “the org”.

### [TEMP-AUTH-014] Password policy is HTML-only (8) vs GoTrue min 6, no server check
- **Severity:** minor
- **Bars:** polish
- **Area:** auth
- **Status:** open
- **Evidence (code):** `signup.tsx:27, 101` — `minLength={8}` on the input; action passes `password` through with no length/complexity check. `config.toml:182-185` — `minimum_password_length = 6`, `password_requirements = ""`. Login has no max-length / lockout beyond GoTrue `sign_in_sign_ups = 30` / 5 min / IP (`config.toml:207-208`).
- **Evidence (live):** n/a
- **User / legal impact:** A non-browser client (or a stripped `minLength`) can create a 6-char password. Fine for a closed beta if GoTrue rate limits stay on; weak for public.
- **Fix recipe:**
  1. files: `signup.tsx` action; hosted GoTrue settings; `config.toml` to 8 + `letters_digits` at least.
  2. behavior: reject `< 8` with the generic `humanAuthError` path; do not reveal policy in error timing vs invalid email.
  3. tests to add: 6-char password → `{ error }` and no session; 8-char succeeds (confirmations off).
  4. manual verify: curl POST signup with 6 chars.
- **Do not:** implement a custom hasher; inspect password in logs.

### [TEMP-AUTH-015] Signup enumerates registered emails
- **Severity:** minor
- **Bars:** polish
- **Area:** auth
- **Status:** open (copy path existed as mapped error; calling it out as enumeration)
- **Evidence (code):** `auth-flow.server.ts:33-36, 39-41` maps `"User already registered"` → `"An account with this email already exists — log in instead."` Signup renders that string (`signup.tsx:68-72`). Login maps invalid credentials to a message that also nudges “create an account” (`auth-flow.server.ts:34`) but does not distinguish unknown vs wrong password (good).
- **Evidence (live):** n/a
- **User / legal impact:** Anyone can test whether an AR staff email has a NudgePay account. Low severity for a named B2B team; avoid amplifying it in the public product.
- **Fix recipe:**
  1. files: `auth-flow.server.ts`, signup action.
  2. behavior: existing email → same confirm-email (or generic) response as a new signup; do not change login timing.
  3. tests to add: `humanAuthError` / signup action: duplicate email does not include “already exists”.
  4. manual verify: sign up twice, both times “check your email”.
- **Do not:** add a dedicated `/api/check-email` endpoint; make login return “email not found” as a “balancing” change.

---

## What is solid

These were re-read at HEAD and should not be “fixed” in ways that undo them.

1. **`getUser()` not `getSession()`** — `session.server.ts:9` revalidates the JWT with GoTrue on every request.
2. **Authenticated mutations are same-origin fail-closed** — `csrf.server.ts:16-28` (Origin, else Referer, else 403). Wired through `requireUser` (`session.server.ts:26`). Covered by `tests/session.test.ts:111-159`.
3. **GET login bounce preserves path** — `session.server.ts:16-23`; POST unauthenticated does **not** attach `returnTo` (avoids converting a CSRF POST into a stored redirect).
4. **`safeReturnTo` is a real open-redirect guard** — `return-to.ts:5-18` (single `/`, no `//`, no `\` or controls). Tests: `tests/return-to.test.ts` (protocol-relative, absolute URL, query-only, backslash, tab).
5. **Login honors `returnTo` before `resolveOrg`** — `login.tsx:35-38` so an org-less invitee reaches `/accept/:token` instead of `/onboarding`. Do not invert this when fixing **004**.
6. **`signupOutcome` is the right production branch** — `auth-flow.server.ts:12-16` + `tests/auth-flow.test.ts:12-18`. Bug is the missing confirm route / dropped headers (**002**), not the decision helper.
7. **`humanAuthError` does not leak unmapped GoTrue strings** — `auth-flow.server.ts:39-41` (invite is the exception, **009**).
8. **Logout GET is non-mutating** — `logout.tsx:12-14`. Logout UI is POST (`AppShell.tsx:154`).
9. **Onboarding and invite loaders are auth+org gated** — `onboarding.tsx:20-25`; `invite.tsx:19-25`.
10. **Invite owner gate is triple-layered** — loader `org.role !== "owner"` → `/dashboard` (`invite.tsx:24`); action `"Only owners can invite"` (`invite.tsx:32`); RLS `invites_owner_write` (`0032_security_hardening.sql:22-25`). Member insert blocked in `tests/rls.test.ts:35-48`.
11. **Invite tokens are 128-bit** — `0003_invites.sql:5` `encode(gen_random_bytes(16), 'hex')`.
12. **Invite expiry is 14 days and enforced** — default `now() + 14 days` (`0032:10-20`); loader `expired` (`accept.$token.tsx:35, 83-88`); `acceptInvite` (`orgs.server.ts:20-22`); `tests/orgs.test.ts:32-51`.
13. **Accept email match is case-insensitive and empty-proof** — `orgs.server.ts:16-18`; `accept.$token.tsx:43-45, 90-95`; `tests/onboarding.test.ts:33-67`.
14. **Accept is CSRF-protected** — `accept.$token.tsx:53` uses `requireUser`.
15. **Memberships are not self-serve writable** — no INSERT policy; app uses service role after owner/invite checks. Unique `(org_id, user_id)` (`0001_tenancy_schema.sql:18`).
16. **`is_org_member` / `is_org_owner` are `security definer` with `search_path = public`** — `0001:24-35`, `0016:6-17`.
17. **Display names exist** (gap-analysis B3 is stale) — signup writes `user_metadata.display_name` (`signup.tsx:35`); profile updates it (`api.profile.tsx:21-23`, max 80); `displayLabel` prefers it (`names.ts:10-16`); chrome uses it (`workspace.server.ts:41-42`). Email local-part is fallback only (`names.ts:17`). Residual: invitees who already had an account without metadata, and **013**.
18. **QBO OAuth user binding** (PR #43 at this HEAD) — `oauth_states.user_id` NOT NULL (`0034_oauth_state_user_binding.sql:1-12`); nonce insert stores `userId` (`oauth-state.server.ts:12-19`); consume is single-use (delete-before-success, `oauth-state.server.ts:22-34`; `tests/oauth-state.test.ts`); callback requires `org.role === "owner" && org.org_id === oauthState.orgId && user.id === oauthState.userId` (`auth.qbo.callback.tsx:24-31`). Connect is owner-only POST (`api.qbo.connect.tsx:11-14`). Intuit unsigned GET disconnect does **not** clear tokens (`auth-flow.server.ts:18-27`, `api.qbo.disconnect.tsx:28-40`).
19. **`oauth_states` is service-role-only** — RLS on, no policies (`0004_qbo_oauth.sql:8-10`).
20. **Org create compensates membership failure** — `orgs.server.ts:46-48` (does not help replay success — **010**).

Note: QBO callback `catch` redirects to `/dashboard?qbo=error` **without** `headers` (`auth.qbo.callback.tsx:35-36`), which can drop a refreshed session cookie on the error path. Not a binding bug; fold into a later session-hygiene pass with **002**’s “never return without `headers`”.

---

## Hunt checklist

| Hunt item | Result |
|---|---|
| no password reset | **001** blocker |
| no change password / email / delete | **006** blocker |
| no `/auth/confirm` | **002** blocker |
| signup confirm `Set-Cookie` drop | **002** (`signup.tsx:41`) |
| logout CSRF | **005** minor (Lax mitigates) |
| login CSRF + `returnTo` | **004** major (`returnTo` itself is safe) |
| invite no email / copy-link | **007** major |
| invite owner gate | **solid** (#10) |
| invite duplicate pending | **008** minor |
| invite 14-day expiry | **solid** (#12) |
| invite raw DB errors | **009** minor |
| onboarding replay orphan orgs | **010** major |
| multi-org trap (`resolveOrg` oldest) | **011** major |
| no member removal / role / leave | **012** blocker |
| memberships RLS no DELETE | **012** (`0002:23-24`) |
| `listOrgMembers` 1000-user cap | **013** major |
| email-local-part vs display names | **solid** (#17); residual fallback + **013** |
| cookie flags | **003** major |
| QBO callback user binding | **solid** (#18) |

---

## Files-read checklist

- `nudgepay-app/app/routes.ts`
- `nudgepay-app/app/routes/login.tsx`
- `nudgepay-app/app/routes/signup.tsx`
- `nudgepay-app/app/routes/logout.tsx`
- `nudgepay-app/app/routes/onboarding.tsx`
- `nudgepay-app/app/routes/invite.tsx`
- `nudgepay-app/app/routes/accept.$token.tsx`
- `nudgepay-app/app/routes/api.profile.tsx`
- `nudgepay-app/app/routes/auth.qbo.callback.tsx`
- `nudgepay-app/app/routes/api.qbo.connect.tsx`
- `nudgepay-app/app/routes/api.qbo.disconnect.tsx`
- `nudgepay-app/app/routes/settings.tsx`
- `nudgepay-app/app/routes/home.tsx`
- `nudgepay-app/app/routes/privacy.tsx`
- `nudgepay-app/app/lib/session.server.ts`
- `nudgepay-app/app/lib/auth-flow.server.ts`
- `nudgepay-app/app/lib/return-to.ts`
- `nudgepay-app/app/lib/csrf.server.ts`
- `nudgepay-app/app/lib/supabase.server.ts`
- `nudgepay-app/app/lib/oauth-state.server.ts`
- `nudgepay-app/app/lib/orgs.server.ts`
- `nudgepay-app/app/lib/names.ts`
- `nudgepay-app/app/lib/workspace.server.ts`
- `nudgepay-app/app/lib/env.server.ts`
- `nudgepay-app/app/components/AppShell.tsx` (logout control)
- `nudgepay-app/app/components/PublicLayout.tsx`
- `nudgepay-app/workers/app.ts`
- `nudgepay-app/supabase/config.toml` (`[auth]`, `[auth.email]`, `[auth.sessions]`, `[auth.rate_limit]`)
- `nudgepay-app/supabase/migrations/0001_tenancy_schema.sql`
- `nudgepay-app/supabase/migrations/0002_rls_policies.sql`
- `nudgepay-app/supabase/migrations/0003_invites.sql`
- `nudgepay-app/supabase/migrations/0004_qbo_oauth.sql`
- `nudgepay-app/supabase/migrations/0016_org_scheduling_config.sql` (`is_org_owner`)
- `nudgepay-app/supabase/migrations/0032_security_hardening.sql`
- `nudgepay-app/supabase/migrations/0034_oauth_state_user_binding.sql`
- `nudgepay-app/tests/session.test.ts`
- `nudgepay-app/tests/auth-flow.test.ts`
- `nudgepay-app/tests/return-to.test.ts`
- `nudgepay-app/tests/oauth-state.test.ts`
- `nudgepay-app/tests/onboarding.test.ts`
- `nudgepay-app/tests/orgs.test.ts`
- `nudgepay-app/tests/names.test.ts`
- `nudgepay-app/tests/rls.test.ts`
- `nudgepay-app/tests/routes-registration.test.ts`
- `nudgepay-app/tests/helpers.ts`
- `nudgepay-app/node_modules/@supabase/ssr/src/utils/constants.ts`
- `nudgepay-app/node_modules/@supabase/ssr/src/createServerClient.ts`
- `nudgepay-app/node_modules/@supabase/ssr/src/cookies.ts`
- `nudgepay-app/node_modules/@supabase/ssr/src/utils/helpers.ts`
- `docs/codebase-audit-2026-07-13.md` (B0, M1–M5, minors 1/39/40/43/44/52)
- `docs/gap-analysis-2026-07-02.md` (B3 display-name — superseded by `display_name`)
- `docs/production-audit-2026-08-20/wave-0/freeze.md`
