# NudgePay Phase 4 — Intuit Submission & Go-Live Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NudgePay submission-ready for Intuit production credentials — substantive legal pages, the two production-auth/disconnect code gaps closed, production config wired, and a complete deploy/demo/submit runbook — so the operator's live steps are a guided button-press.

**Architecture:** Phases 1–3 shipped a typed, multi-tenant React Router v7 app on Cloudflare Workers + Supabase, mock-tested locally with no live external calls. Phase 4 does NOT deploy in-session. It produces every in-repo deliverable Intuit's production review needs: hardened legal route content, two route code-fixes (Intuit-initiated disconnect; production signup email-confirmation path), a `[env.production]` wrangler block + secrets manifest, and five operator documents (app-details reference, deploy runbook, sandbox demonstration script, security-questionnaire crib, go-live pre-flight checklist). Live provisioning, domain choice, Intuit-portal data entry, A2P 10DLC registration, and the final connect-real-Chancey action are explicitly the operator's, post-handoff.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers; Supabase Postgres + Auth (`@supabase/ssr` user client, `@supabase/supabase-js` service client); Vitest against local Supabase; Web Crypto only; raw REST for QBO/Twilio. Markdown for operator docs.

## Global Constraints

These bind every task. Copied from the project's established invariants (master spec §5/§6 and Phases 1–3 ledger).

- **No `node:*` / Node built-ins in app code** (`app/**`). Workers + Web Crypto only. (`node:fs` is allowed in `tests/**` only.)
- **Security boundary:** browser → app's own server routes only; privileged writes use the service-role client; RLS-scoped reads use the user client. Never expose service key or tokens to the browser.
- **OAuth/disconnect callbacks redirect or render — never leak tokens or sensitive params** into HTML, logs, or referrer.
- **QBO tokens encrypted at rest** (AES-256-GCM); never logged; revoked + cleared on disconnect.
- **Multi-tenant:** every domain row carries `org_id`; privileged access resolves the caller's org via session.
- **Tests:** run against shared local Supabase in parallel — NEVER global-truncate; use per-test fresh orgs and org-scoped assertions. No live QBO/Twilio/Intuit network calls in tests (inject `fetch`/use pure helpers). `.env.test` is gitignored and never committed; never commit secrets.
- **Conventional Commits:** `feat:` / `fix:` / `refactor:` / `test:` / `docs:`.
- **Verification floor for code tasks:** `npx vitest run` (relevant files) + `npx tsc --noEmit` + `npx react-router build` must all pass. Content/doc tasks verify by build (for route content) and a self-review checklist (for markdown).
- **Operator URL templating:** no production domain is chosen yet. Every Intuit/Twilio URL in docs uses the literal placeholder `${APP_BASE_URL}` (e.g. `${APP_BASE_URL}/api/qbo/connect`), with `https://nudgepay.<account>.workers.dev` recommended as the default to unblock review.
- **Legal-copy fill-ins:** marked literally as `[Legal Entity Name]`, `[Contact Email]` (default shown: `support@nudgepay-ar.app`), `[Governing-Law State]`, `[Effective Date]` — never silently invented.

---

## File Structure

**Code / content (in `nudgepay-app/`):**
- `app/lib/auth-flow.server.ts` — **Create.** Pure decision helpers: `signupOutcome(hasSession)` and `intuitDisconnectPlan(org)`. Pure, unit-tested, no I/O. Keeps route files thin and the decisions testable without cookie infrastructure.
- `app/routes/signup.tsx` — **Modify.** Branch on `signUp` returned session via `signupOutcome`; render a "check your email" state when no session.
- `app/routes/api.qbo.disconnect.tsx` — **Modify.** GET (`loader`) becomes the Intuit Disconnect URL landing: resolve org from session, clear tokens via `disconnectConnection`, render confirmation. Keep the existing owner-gated POST `action`.
- `app/routes/privacy.tsx` — **Modify.** Substantive Privacy Policy content.
- `app/routes/eula.tsx` — **Modify.** Substantive EULA content.
- `wrangler.toml` — **Modify.** Add a documented `[env.production]` block + full secret manifest comment.
- `tests/auth-flow.test.ts` — **Create.** Unit tests for the pure decision helpers.

**Operator docs (in `docs/superpowers/`):**
- `phase4-intuit-app-details.md` — **Create.** Every Intuit App Details portal field → exact value or `${APP_BASE_URL}`-templated URL.
- `phase4-deploy-runbook.md` — **Create.** Provision → migrate → secrets → deploy → wire portal URLs.
- `phase4-sandbox-demonstration.md` — **Create.** The click-path that demonstrates connect → encrypted token → sync → webhook → disconnect for Intuit review.
- `phase4-security-questionnaire-crib.md` — **Create.** Each Intuit security answer → where it's satisfied in code.
- `phase4-go-live-preflight.md` — **Create.** Final gated checklist (every secret set, toggles, A2P status, connect-real-Chancey last).

---

## Task 1: Production signup email-confirmation path (code gap C2)

**Why:** In production Supabase, email-confirmation is ON, so `supabase.auth.signUp` returns `{ user, session: null }` — no auth cookie is set. The current `signup.tsx` always `redirect("/onboarding")`, and `/onboarding` (which requires a user) would bounce to `/login`. Phase 1's final review explicitly flagged this for "when real auth enabled." Phase 4 enables real auth.

**Files:**
- Create: `nudgepay-app/app/lib/auth-flow.server.ts`
- Create: `nudgepay-app/tests/auth-flow.test.ts`
- Modify: `nudgepay-app/app/routes/signup.tsx`

**Interfaces:**
- Produces: `signupOutcome(hasSession: boolean): { redirectTo: string } | { confirmEmail: true }` — used by `signup.tsx`. When a session exists (local dev / confirmation OFF) → `{ redirectTo: "/onboarding" }`; when null (production / confirmation ON) → `{ confirmEmail: true }`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/auth-flow.test.ts`:

```ts
import { expect, test } from "vitest";
import { signupOutcome } from "../app/lib/auth-flow.server";

test("signupOutcome redirects to onboarding when a session is returned (confirmation off)", () => {
  expect(signupOutcome(true)).toEqual({ redirectTo: "/onboarding" });
});

test("signupOutcome asks the user to confirm email when no session is returned (confirmation on)", () => {
  expect(signupOutcome(false)).toEqual({ confirmEmail: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/auth-flow.test.ts`
Expected: FAIL — `Failed to resolve import "../app/lib/auth-flow.server"` (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

Create `nudgepay-app/app/lib/auth-flow.server.ts`:

```ts
// Pure decision helpers for auth routes. No I/O — keeps route files thin and
// these branches unit-testable without cookie/session infrastructure.

export type SignupOutcome = { redirectTo: string } | { confirmEmail: true };

// Supabase signUp returns a session only when email confirmation is OFF
// (local dev). In production (confirmation ON) session is null and no auth
// cookie is set, so redirecting to an auth-gated page would bounce to /login.
export function signupOutcome(hasSession: boolean): SignupOutcome {
  return hasSession ? { redirectTo: "/onboarding" } : { confirmEmail: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/auth-flow.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Wire the helper into the signup route**

Modify `nudgepay-app/app/routes/signup.tsx` to branch on the returned session and render a confirm-email state. Full new file content:

```tsx
import { Form, redirect, useActionData, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { signupOutcome } from "../lib/auth-flow.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  const outcome = signupOutcome(Boolean(data.session));
  if ("redirectTo" in outcome) return redirect(outcome.redirectTo, { headers });
  return { confirmEmail: true as const };
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  if (actionData && "confirmEmail" in actionData && actionData.confirmEmail) {
    return (
      <main style={{ maxWidth: 360, margin: "64px auto" }}>
        <h1>Check your email</h1>
        <p>We sent a confirmation link to your inbox. Click it to finish creating
          your NudgePay account, then sign in.</p>
      </main>
    );
  }
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Create your NudgePay account</h1>
      {actionData && "error" in actionData && actionData.error && (
        <p style={{ color: "#C0202A" }}>{actionData.error}</p>
      )}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required minLength={8} />
      <button type="submit">Sign up</button>
    </Form>
  );
}
```

- [ ] **Step 6: Verify typecheck and build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: both succeed, no errors. (Local dev still redirects to `/onboarding` because local Supabase returns a session — behavior unchanged for existing local flow.)

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/auth-flow.server.ts nudgepay-app/tests/auth-flow.test.ts nudgepay-app/app/routes/signup.tsx
git commit -m "fix: handle production email-confirmation signup (no-session) path"
```

---

## Task 2: Intuit Disconnect URL handler (code gap C1)

**Why:** Intuit's portal requires a **Disconnect URL** that Intuit's browser hits when a user disconnects the app from Intuit's "My Apps" page. Today `api.qbo.disconnect.tsx`'s `loader` (GET) just `redirect("/dashboard")` — it does NOT revoke or clear stored tokens, leaving stale encrypted tokens for a connection Intuit has already severed. The fix makes the GET path resolve the caller's org from session and clear tokens via the already-tested `disconnectConnection`, then render a confirmation page (not a bounce). The existing owner-gated POST `action` (in-app disconnect button) is preserved.

**Design decision (encode in the helper):** Intuit-initiated disconnect means Intuit has *already* revoked on their side. Any authenticated user whose session resolves to an org should therefore clear that org's stale tokens — this only reflects state Intuit already enforced. No session → render a generic confirmation, clear nothing. `disconnectConnection`'s revoke step is best-effort (it swallows revoke errors) so calling it against already-revoked tokens is safe.

**Testing approach:** Per repo precedent, auth-gated route loaders are not unit-tested (no cookie helper exists; Phase 2A connect/callback/disconnect routes were verified by typecheck+build with logic in tested libs). The only NEW logic — the authorization/clear decision — is extracted into the pure `intuitDisconnectPlan` and unit-tested. The cleanup itself reuses `disconnectConnection`, already covered by `tests/qbo-connection.test.ts`.

**Files:**
- Modify: `nudgepay-app/app/lib/auth-flow.server.ts` (add `intuitDisconnectPlan`)
- Modify: `nudgepay-app/tests/auth-flow.test.ts` (add cases)
- Modify: `nudgepay-app/app/routes/api.qbo.disconnect.tsx`

**Interfaces:**
- Consumes: `disconnectConnection(fetchFn, service, cfg, key, orgId)` from `app/lib/qbo-connection.server.ts`; `requireUser`, `resolveOrg` from `app/lib/session.server.ts`; `getEnv`, `getQboEnv` from `app/lib/env.server.ts`; `createSupabaseServiceClient` from `app/lib/supabase.server.ts`.
- Produces: `intuitDisconnectPlan(org: { org_id: string; role: string } | null): { clear: boolean; orgId: string | null }` — `clear: true` with the org id whenever a session resolves to any org; `{ clear: false, orgId: null }` when org is null.

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/auth-flow.test.ts`:

```ts
import { intuitDisconnectPlan } from "../app/lib/auth-flow.server";

test("intuitDisconnectPlan clears tokens for any authenticated org (owner)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-1", role: "owner" }))
    .toEqual({ clear: true, orgId: "org-1" });
});

test("intuitDisconnectPlan clears tokens for a non-owner member too (Intuit already revoked)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-2", role: "member" }))
    .toEqual({ clear: true, orgId: "org-2" });
});

test("intuitDisconnectPlan clears nothing when there is no session/org", () => {
  expect(intuitDisconnectPlan(null)).toEqual({ clear: false, orgId: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/auth-flow.test.ts`
Expected: FAIL — `intuitDisconnectPlan is not a function` / import has no such export.

- [ ] **Step 3: Add the helper**

Append to `nudgepay-app/app/lib/auth-flow.server.ts`:

```ts
// Intuit's Disconnect URL is hit by Intuit's browser AFTER Intuit has already
// revoked the connection on their side. Any authenticated session that resolves
// to an org should clear that org's now-stale tokens (reflecting state Intuit
// already enforced); without a session we can't identify an org, so clear
// nothing and just render a confirmation.
export function intuitDisconnectPlan(
  org: { org_id: string; role: string } | null,
): { clear: boolean; orgId: string | null } {
  if (org) return { clear: true, orgId: org.org_id };
  return { clear: false, orgId: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/auth-flow.test.ts`
Expected: PASS (5 passed total).

- [ ] **Step 5: Rewrite the disconnect route**

Replace `nudgepay-app/app/routes/api.qbo.disconnect.tsx` entirely:

```tsx
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { disconnectConnection } from "../lib/qbo-connection.server";
import { intuitDisconnectPlan } from "../lib/auth-flow.server";

function qboCfg(qbo: ReturnType<typeof getQboEnv>) {
  return { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI };
}

// In-app "Disconnect" button: owner-gated POST.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return redirect("/dashboard?qbo=forbidden", { headers });
  const service = createSupabaseServiceClient(env);
  await disconnectConnection(fetch, service, qboCfg(qbo), qbo.QBO_ENCRYPTION_KEY, org.org_id);
  return redirect("/dashboard?qbo=disconnected", { headers });
}

// Intuit Disconnect URL landing: Intuit redirects the user's browser here after
// they disconnect from Intuit's My Apps. Intuit has already revoked on their
// side, so clear our now-stale tokens for the caller's org and render a
// confirmation (no redirect — the user may not be in an app session flow).
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const qbo = getQboEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  const plan = intuitDisconnectPlan(org);
  if (plan.clear && plan.orgId) {
    const service = createSupabaseServiceClient(env);
    await disconnectConnection(fetch, service, qboCfg(qbo), qbo.QBO_ENCRYPTION_KEY, plan.orgId);
  }
  return new Response(
    "<!doctype html><meta charset=utf-8><title>Disconnected</title>" +
      "<main style=\"max-width:480px;margin:64px auto;font-family:sans-serif\">" +
      "<h1>QuickBooks disconnected</h1><p>Your QuickBooks Online connection has been " +
      "removed and stored tokens were cleared. You can reconnect any time from your " +
      "NudgePay dashboard.</p></main>",
    { status: 200, headers: (() => { headers.set("Content-Type", "text/html; charset=utf-8"); return headers; })() },
  );
}
```

Note: `requireUser` throws a redirect to `/login` when there is no session — Intuit's disconnect landing then sends the user to log in, after which a revisit clears tokens. This is acceptable and leaks nothing. The confirmation HTML contains no tokens or sensitive params (Global Constraint: no token/param leakage).

- [ ] **Step 6: Verify the full suite, typecheck, and build**

Run: `cd nudgepay-app && npx vitest run tests/auth-flow.test.ts && npx tsc --noEmit && npx react-router build`
Expected: auth-flow 5/5 pass; typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/auth-flow.server.ts nudgepay-app/tests/auth-flow.test.ts nudgepay-app/app/routes/api.qbo.disconnect.tsx
git commit -m "fix: handle Intuit-initiated disconnect URL and clear stale tokens"
```

---

## Task 3: Production wrangler config + secrets manifest (code gap C3)

**Why:** Going to production is config, not app-code: the QBO sandbox↔prod switch already exists (`getQboEnv` reads `QBO_SANDBOX !== "false"`, default true) and only gates the Data API base URL — OAuth authorize/token/revoke endpoints are fixed constants in `qbo-client.server.ts`, identical for sandbox and prod. This task adds a documented `[env.production]` block to `wrangler.toml` (sets `QBO_SANDBOX=false`) and a complete secret manifest so the deploy runbook (Task 6) has an authoritative list. No app-code change.

**Files:**
- Modify: `nudgepay-app/wrangler.toml`

**Interfaces:** none (config only).

- [ ] **Step 1: Confirm the sandbox flag gates only the Data API (evidence, not a change)**

Run: `cd nudgepay-app && grep -rn "QBO_SANDBOX\|qboApiBaseUrl\|appcenter.intuit.com\|oauth.platform.intuit.com" app/lib/ || true`
Expected: `QBO_SANDBOX` is read only in `env.server.ts`; the sandbox boolean flows only into `qboApiBaseUrl(...)` in `qbo-api.server.ts`; the authorize/token/revoke URLs in `qbo-client.server.ts` are hardcoded constants with no sandbox branch. Record this confirmation in the task report. (If a sandbox branch is found on the OAuth URLs, STOP and flag — that would be a real bug.)

- [ ] **Step 2: Add the production env block + secret manifest to `wrangler.toml`**

Append to `nudgepay-app/wrangler.toml`:

```toml
# --- Production environment ---------------------------------------------------
# Deploy with: npx wrangler deploy --env production
# Non-secret production vars (secrets are set separately via `wrangler secret put`).
[env.production.vars]
SUPABASE_URL = "https://<your-prod-project-ref>.supabase.co"
QBO_SANDBOX = "false"   # production QBO: gates ONLY the Data API base URL

# [env.production.triggers] mirrors the top-level CDC cron.
[env.production.triggers]
crons = ["*/30 * * * *"]

# Secrets required in production (set each: `npx wrangler secret put <NAME> --env production`):
#   SUPABASE_ANON_KEY            Supabase anon/publishable key
#   SUPABASE_SERVICE_KEY         Supabase service-role key (server-only)
#   QBO_CLIENT_ID                Intuit PRODUCTION app client id
#   QBO_CLIENT_SECRET            Intuit PRODUCTION app client secret
#   QBO_REDIRECT_URI             ${APP_BASE_URL}/auth/qbo/callback  (must match Intuit app Redirect URI exactly)
#   QBO_ENCRYPTION_KEY           base64 of 32 random bytes (AES-256) — same key family as other envs; never rotate without re-encrypting
#   QBO_WEBHOOK_VERIFIER_TOKEN   Intuit webhook verifier token (from the production app's Webhooks page)
#   TWILIO_ACCOUNT_SID           Twilio account SID
#   TWILIO_AUTH_TOKEN            Twilio auth token
#   TWILIO_MESSAGING_SERVICE_SID Production Messaging Service SID (preferred sender)  -- or --
#   TWILIO_FROM_NUMBER           E.164 sender number (fallback if no Messaging Service)
#   TWILIO_PUBLIC_BASE_URL       ${APP_BASE_URL}  (origin Twilio uses for signature validation + StatusCallback)
# DEPLOY GATE: getQboEnv requires QBO_WEBHOOK_VERIFIER_TOKEN and getTwilioEnv requires the Twilio
# secrets — QBO/Twilio routes throw 500 at runtime until every secret above is set.
```

- [ ] **Step 3: Validate the wrangler config**

Run: `cd nudgepay-app && npx wrangler deploy --env production --dry-run --outdir /tmp/wrangler-dryrun 2>&1 | tail -20 || npx react-router build`
Expected: the dry-run parses the config and bundles without deploying (no network publish); if `wrangler` is unavailable, the fallback `react-router build` succeeds. Record which ran in the report. (A dry-run never publishes — confirm the output says it did not deploy.)

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/wrangler.toml
git commit -m "chore: add production wrangler env block and secrets manifest"
```

---

## Task 4: Substantive legal pages — Privacy Policy + EULA (D1)

**Why:** Intuit reviewers read the Privacy Policy and EULA. The current routes are one-paragraph stubs that will not pass review. This task expands both into substantive documents covering the data-handling, consent, retention, and sub-processor disclosures Intuit and TCPA/A2P expect, with clearly-marked fill-ins for facts the operator must supply.

**Files:**
- Modify: `nudgepay-app/app/routes/privacy.tsx`
- Modify: `nudgepay-app/app/routes/eula.tsx`

**Interfaces:** none (static route components).

**Verification approach:** static content — verified by `react-router build` (compiles/renders) plus a self-review checklist of required sections. No unit test (no render-test infra exists; adding it would be net-new infrastructure for static copy — YAGNI).

**Required Privacy Policy sections (checklist the reviewer will verify are present):**
1. Who we are + `[Contact Email]` (default `support@nudgepay-ar.app`) + `[Effective Date]`.
2. **Data we access from QuickBooks Online:** invoices, customers, balances, due dates — used only to display overdue invoices and manage collections.
3. **OAuth token handling:** refresh/access tokens encrypted at rest (AES-256), never exposed to the browser, revoked and deleted on disconnect.
4. **Messaging data (Twilio):** phone numbers, message bodies, delivery status; SMS sent only to customers with recorded consent; STOP/HELP opt-out honored; TCPA/A2P 10DLC compliance.
5. **Account data:** user email + team membership for authentication.
6. **Storage & security:** encrypted in transit and at rest; row-level security isolates each organization's data.
7. **Sub-processors:** Intuit (QuickBooks), Twilio (SMS), Supabase (database/auth), Cloudflare (hosting).
8. **Retention & deletion:** disconnect revokes/deletes QBO tokens; how to request data deletion via `[Contact Email]`.
9. **No sale of data.**
10. `[Legal Entity Name]` and `[Governing-Law State]` fill-ins present.

**Required EULA sections:**
1. License grant (limited, non-exclusive, for the customer's own AR collections).
2. Acceptable use: own business only; lawful use; **operator is responsible for TCPA/A2P consent before texting customers.**
3. As-is / private-beta disclaimer; no warranty.
4. Limitation of liability.
5. Termination: either party may terminate; on termination QBO tokens are revoked and removed.
6. `[Legal Entity Name]`, `[Governing-Law State]`, `[Effective Date]` fill-ins present.

- [ ] **Step 1: Rewrite the Privacy Policy route**

Replace `nudgepay-app/app/routes/privacy.tsx`:

```tsx
const updated = "[Effective Date]";
const contact = "[Contact Email] (default: support@nudgepay-ar.app)";

export default function Privacy() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", fontFamily: "sans-serif", lineHeight: 1.5 }}>
      <h1>NudgePay Privacy Policy</h1>
      <p>Effective date: {updated}. Operated by [Legal Entity Name] ("we", "us").</p>

      <h2>1. Who we are</h2>
      <p>NudgePay is an accounts-receivable collections tool that connects to your
        QuickBooks Online account to surface overdue invoices and help your team
        follow up. Questions: {contact}.</p>

      <h2>2. Data we access from QuickBooks Online</h2>
      <p>With your authorization we read invoices, customers, balances, and due
        dates. We use this data solely to display overdue invoices and manage
        collections on your behalf. We do not access QuickBooks data beyond what
        these features require.</p>

      <h2>3. QuickBooks authorization tokens</h2>
      <p>OAuth access and refresh tokens are encrypted at rest using AES-256 and
        are never exposed to your browser. When you disconnect QuickBooks, we
        revoke the tokens with Intuit and delete them from our systems.</p>

      <h2>4. Messaging data (SMS)</h2>
      <p>When you text a customer, we process the destination phone number, the
        message body, and Twilio delivery status. We send SMS only to customers
        with recorded consent, honor STOP/HELP opt-out keywords, and operate in
        compliance with TCPA and A2P 10DLC requirements.</p>

      <h2>5. Account data</h2>
      <p>We store your user email and team membership to authenticate you and
        control access to your organization's data.</p>

      <h2>6. Storage and security</h2>
      <p>All data is encrypted in transit and at rest. Row-level security isolates
        each organization's data so members of one organization cannot access
        another's.</p>

      <h2>7. Sub-processors</h2>
      <p>We rely on Intuit (QuickBooks Online), Twilio (SMS delivery), Supabase
        (database and authentication), and Cloudflare (application hosting).</p>

      <h2>8. Data retention and deletion</h2>
      <p>Disconnecting QuickBooks revokes and deletes stored tokens. To request
        deletion of your other stored data, contact {contact}.</p>

      <h2>9. No sale of data</h2>
      <p>We do not sell your data or share it for advertising.</p>

      <h2>10. Governing law</h2>
      <p>This policy is governed by the laws of [Governing-Law State].</p>
    </main>
  );
}
```

- [ ] **Step 2: Rewrite the EULA route**

Replace `nudgepay-app/app/routes/eula.tsx`:

```tsx
export default function Eula() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", fontFamily: "sans-serif", lineHeight: 1.5 }}>
      <h1>NudgePay End User License Agreement</h1>
      <p>Effective date: [Effective Date]. This agreement is between you and
        [Legal Entity Name].</p>

      <h2>1. License</h2>
      <p>We grant you a limited, non-exclusive, non-transferable license to use
        NudgePay to manage your own business's accounts-receivable collections.</p>

      <h2>2. Acceptable use</h2>
      <p>You will use NudgePay only for your own business and in compliance with
        applicable law. You are solely responsible for obtaining and maintaining
        valid consent (TCPA / A2P 10DLC) before sending SMS to your customers,
        and for honoring opt-out requests.</p>

      <h2>3. Disclaimer</h2>
      <p>NudgePay is provided "as is" during private beta, without warranties of
        any kind, express or implied.</p>

      <h2>4. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, [Legal Entity Name] is not liable
        for indirect, incidental, or consequential damages arising from your use
        of NudgePay.</p>

      <h2>5. Termination</h2>
      <p>Either party may terminate access at any time. On termination, your
        QuickBooks tokens are revoked with Intuit and removed from our systems.</p>

      <h2>6. Governing law</h2>
      <p>This agreement is governed by the laws of [Governing-Law State].</p>
    </main>
  );
}
```

- [ ] **Step 3: Verify build (compiles + renders both routes)**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: typecheck clean; build succeeds (both route modules compile).

- [ ] **Step 4: Self-review against the section checklists above**

Confirm every numbered Privacy section (1–10) and EULA section (1–6) is present, and that all four fill-in tokens (`[Legal Entity Name]`, `[Contact Email]`, `[Governing-Law State]`, `[Effective Date]`) appear. Record the checklist pass in the task report.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/privacy.tsx nudgepay-app/app/routes/eula.tsx
git commit -m "docs: expand Privacy Policy and EULA to Intuit-review-ready content"
```

---

## Task 5: Intuit App Details reference doc (D2)

**Why:** The operator must fill Intuit's production "App Details" form. This doc is the authoritative source: every field → its exact value or an `${APP_BASE_URL}`-templated URL, derived from the actual routes in `app/routes/`.

**Files:**
- Create: `docs/superpowers/phase4-intuit-app-details.md`

**Verification:** markdown self-review against the checklist below; cross-check each URL path against a real file in `app/routes/`.

- [ ] **Step 1: Write the doc**

Create `docs/superpowers/phase4-intuit-app-details.md` containing a table of every Intuit App Details field with these exact route-backed values (verify each path exists in `app/routes/`):

| Intuit field | Value | Backing route file |
|---|---|---|
| Host domain | `${APP_BASE_URL}` (e.g. `nudgepay.<account>.workers.dev`) | — |
| Launch URL | `${APP_BASE_URL}/dashboard` | `app/routes/dashboard.tsx` |
| Connect / Reconnect URL | `${APP_BASE_URL}/api/qbo/connect` | `app/routes/api.qbo.connect.tsx` |
| Disconnect URL | `${APP_BASE_URL}/api/qbo/disconnect` | `app/routes/api.qbo.disconnect.tsx` (GET landing — Task 2) |
| OAuth Redirect URI | `${APP_BASE_URL}/auth/qbo/callback` | `app/routes/auth.qbo.callback.tsx` |
| EULA URL | `${APP_BASE_URL}/eula` | `app/routes/eula.tsx` |
| Privacy Policy URL | `${APP_BASE_URL}/privacy` | `app/routes/privacy.tsx` |
| Webhook (Production) URL | `${APP_BASE_URL}/webhooks/qbo` | `app/routes/webhooks.qbo.tsx` |

Include sections for: **Scopes** (`com.intuit.quickbooks.accounting` — confirm against `SCOPE` in `qbo-client.server.ts`); **Categories / regulated industries / hosting regions** (operator-supplied, with guidance: AR/collections utility, US hosting via Cloudflare); a **Redirect URI exact-match warning** (must match `QBO_REDIRECT_URI` secret byte-for-byte); and a note that the **Webhook verifier token** from this same Intuit page must be stored as `QBO_WEBHOOK_VERIFIER_TOKEN`.

- [ ] **Step 2: Self-review**

Confirm all 8 table rows, the scope value matches `qbo-client.server.ts`, and every templated path corresponds to an existing route file. Record in report.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/phase4-intuit-app-details.md
git commit -m "docs: add Intuit App Details reference for production submission"
```

---

## Task 6: Deploy & secrets runbook (D3)

**Why:** A single ordered procedure to take the app live: provision production Supabase, run migrations, create the Worker, set every secret, deploy, and wire Intuit + Twilio portal URLs to the deployed domain. References the secret manifest from Task 3.

**Files:**
- Create: `docs/superpowers/phase4-deploy-runbook.md`

**Verification:** markdown self-review; every command must be copy-pasteable and reference real files (`supabase/migrations/`, `wrangler.toml`).

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/phase4-deploy-runbook.md` with these ordered sections, each with exact commands:

1. **Prerequisites:** Cloudflare account + `wrangler login`; Supabase account; Intuit **production** app keys; Twilio production credentials; chosen `${APP_BASE_URL}`.
2. **Production Supabase:** create project; copy URL + anon + service keys; run migrations — list the migration files in order from `nudgepay-app/supabase/migrations/` (`0001`…`0006`) and the command `supabase db push` (or `supabase migration up`) against the linked prod project; confirm RLS is enabled.
3. **Supabase Auth config:** enable email confirmation (this is the production behavior Task 1 handles); set the site URL / redirect allow-list to `${APP_BASE_URL}`.
4. **Secrets:** for each secret in the Task 3 manifest, `npx wrangler secret put <NAME> --env production`. Call out the deploy gate (QBO/Twilio routes 500 until all are set).
5. **Deploy:** `npx wrangler deploy --env production`; capture the deployed URL → this is `${APP_BASE_URL}`.
6. **Custom domain (optional):** how to attach a route/custom domain in Cloudflare and update `QBO_REDIRECT_URI` + `TWILIO_PUBLIC_BASE_URL` + all Intuit/Twilio portal URLs to match.
7. **Wire Intuit portal:** set Redirect URI, Disconnect URL, Launch URL, Host domain, EULA/Privacy URLs, Webhook URL (per Task 5 doc); copy the webhook verifier token into the secret.
8. **Wire Twilio:** set the Messaging Service inbound webhook → `${APP_BASE_URL}/webhooks/twilio/inbound` and status callback → `${APP_BASE_URL}/webhooks/twilio/status`; confirm `TWILIO_PUBLIC_BASE_URL` matches exactly.
9. **Smoke check:** `${APP_BASE_URL}/privacy` and `/eula` return 200; signup → confirm-email path works.

- [ ] **Step 2: Self-review**

Confirm migration filenames match `nudgepay-app/supabase/migrations/`, webhook paths match route files, and the secret list matches Task 3's manifest exactly. Record in report.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/phase4-deploy-runbook.md
git commit -m "docs: add production deploy and secrets runbook"
```

---

## Task 7: Sandbox demonstration script (D4)

**Why:** Intuit grants production credentials only after the OAuth + sync flow is demonstrably working against a QBO **sandbox** on a reachable HTTPS app. This is the click-path that produces that evidence, building on the existing `phase2b-live-sandbox-verification.md`.

**Files:**
- Create: `docs/superpowers/phase4-sandbox-demonstration.md`

**Verification:** markdown self-review; steps reference real routes and the existing Phase 2B verification doc.

- [ ] **Step 1: Write the demonstration script**

Create `docs/superpowers/phase4-sandbox-demonstration.md` covering, as an ordered click-path with the expected observable result at each step:

1. Deploy with sandbox config (`QBO_SANDBOX=true`, Intuit **sandbox** keys) — reference Task 6 runbook, sandbox variant.
2. **Connect:** sign in → dashboard → Connect QuickBooks → authorize sandbox company → redirected back to dashboard showing "connected" (route: `api.qbo.connect` → `auth.qbo.callback`).
3. **Encrypted-token evidence:** in Supabase, show the `qbo_connections` row has `access_token_enc`/`refresh_token_enc` ciphertext (not plaintext) and `status = connected`.
4. **Sync:** click "Refresh from QuickBooks" → overdue invoices appear in the worklist (route: `api.qbo.refresh`, dashboard list filtered to past-due).
5. **Webhook:** make a change in the sandbox company → confirm `${APP_BASE_URL}/webhooks/qbo` receives it (signature-verified) and the invoice updates; reference the CDC cron as the catch-up path.
6. **Disconnect:** trigger disconnect → tokens revoked + cleared (`status = disconnected`, token columns null) — covers both the in-app POST and the Intuit Disconnect URL landing (Task 2).
7. Point to `phase2b-live-sandbox-verification.md` for the lower-level per-endpoint checks.

- [ ] **Step 2: Self-review + cross-reference**

Confirm each route name matches a file in `app/routes/` and the Phase 2B doc path exists. Record in report.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/phase4-sandbox-demonstration.md
git commit -m "docs: add QBO sandbox demonstration script for Intuit review"
```

---

## Task 8: Security-questionnaire crib + go-live pre-flight checklist (D5)

**Why:** Two operator artifacts for the final mile: (a) a crib mapping each Intuit security-questionnaire answer to where it is satisfied in the codebase, so the operator answers truthfully with references; and (b) a go-live pre-flight checklist gating the real-Chancey cutover.

**Files:**
- Create: `docs/superpowers/phase4-security-questionnaire-crib.md`
- Create: `docs/superpowers/phase4-go-live-preflight.md`

**Verification:** markdown self-review; each crib claim must cite a real file/mechanism that exists in the repo.

- [ ] **Step 1: Write the security-questionnaire crib**

Create `docs/superpowers/phase4-security-questionnaire-crib.md` mapping each common Intuit security requirement to its implementation, citing real code:

- Encrypted token storage → AES-256-GCM in `app/lib/crypto.server.ts`; tokens stored encrypted by `storeConnection` (`app/lib/qbo-connection.server.ts`).
- Tokens never exposed to browser → only server routes touch tokens; service-role client server-only (`supabase.server.ts`).
- OAuth CSRF protection → single-use state nonce (`oauth_states`, verified in `auth.qbo.callback.tsx`).
- No sensitive-param leakage → callback **redirects**, never renders tokens/params.
- Disconnect/revoke → `disconnectConnection` revokes with Intuit + clears tokens; Intuit Disconnect URL handled (`api.qbo.disconnect.tsx`).
- Transport security → HTTPS via Cloudflare; webhook signatures verified before processing (QBO HMAC-SHA256, Twilio HMAC-SHA1).
- Access control → Supabase Auth + RLS (`is_org_member`); cross-org isolation tested (`tests/rls.test.ts`).
- No PII/financial data in logs → webhook handlers log error context only, not QBO/customer payloads.
- Data minimization → only invoice/customer fields needed for collections are read.

- [ ] **Step 2: Write the go-live pre-flight checklist**

Create `docs/superpowers/phase4-go-live-preflight.md` — a final ordered gate:

1. All production secrets set (Task 3 manifest) — else QBO/Twilio routes 500.
2. `QBO_SANDBOX=false` and Intuit **production** keys in place.
3. Intuit app URLs all match `${APP_BASE_URL}` exactly (redirect URI byte-for-byte).
4. Twilio webhooks + `TWILIO_PUBLIC_BASE_URL` match deployed domain.
5. **A2P 10DLC** brand/campaign approved (required before US production texting; start early — external lead time).
6. Legal page fill-ins replaced (`[Legal Entity Name]`, `[Contact Email]`, `[Governing-Law State]`, `[Effective Date]`).
7. Sandbox demonstration (Task 7) passed and shown to Intuit; production credentials granted.
8. **Final gate:** connect the real Chancey QBO company (the only step touching live customer data).

- [ ] **Step 3: Self-review**

Confirm every crib claim cites a file that exists in the repo and every pre-flight item is actionable. Record in report.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/phase4-security-questionnaire-crib.md docs/superpowers/phase4-go-live-preflight.md
git commit -m "docs: add Intuit security-questionnaire crib and go-live pre-flight checklist"
```

---

## Final Verification (whole-branch, before merge)

- [ ] Full suite green: `cd nudgepay-app && npx vitest run` (expect all prior tests + new `auth-flow.test.ts` passing).
- [ ] `npx tsc --noEmit` clean; `npx react-router build` succeeds.
- [ ] No secrets committed; `.env.test` still gitignored.
- [ ] All four legal fill-in tokens present (operator must replace before go-live).
- [ ] Dispatch the final whole-branch code review (most capable model) over the branch diff.

## Out of Scope (operator's, post-handoff — do NOT attempt in-session)

- Provisioning Cloudflare / Supabase accounts; choosing/configuring a domain.
- Entering data in Intuit's developer portal; submitting the questionnaire.
- A2P 10DLC registration.
- The final connect-real-Chancey-QBO action.
- Phase 5 (cutover: retire Netlify/Railway, port remaining prototype UI, final security review).
