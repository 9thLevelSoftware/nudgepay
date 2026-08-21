# Build and test evidence

Audit date: 2026-08-20. Working directory: `D:\nudgepay\nudgepay-app`. Exit codes are process exit codes.

| Command | Exit | Result / classification |
|---|---:|---|
| `npm ci` | 0 | Install succeeded: 342 packages added, 343 audited; npm reported 17 vulnerabilities (2 low, 1 moderate, 14 high). |
| `npx vitest run` (run 1) | 1 | Environment/test setup blocked before collection: no test files found and `tests/global-setup.ts` failed to read missing `.env.test` (`ENOENT`). |
| `npx vitest run` (run 2) | 1 | Same deterministic `.env.test`/`ENOENT` block; no tests executed. |
| `npm run typecheck` | 0 | Wrangler type generation and `tsc -b` passed. |
| `npm run build` (Cloudflare; `BUILD_TARGET` unset) | 0 | Worker/client build passed; output logged one `The build was canceled` message during rendering but completed successfully. |
| `BUILD_TARGET=node npm run build` | 0 | Node/Render build passed; `build/server/index.js` emitted and Cloudflare plugin omitted. |
| `npm run build:cron` | 0 | Bundled `cdc.js` and `digest.js` to `dist-cron/`. |
| `npm run check` | 0 | TypeScript, Cloudflare build, and `wrangler deploy --dry-run` passed; dry-run upload 2187.75 KiB (gzip 415.28 KiB). |
| Node start + `GET http://127.0.0.1:39127/healthz` | 0 | Node server listened; response `200 {"ok":true}`; no stderr. No provider call. |
| `npm audit --json` | 1 | Audit completed with vulnerability report: 17 total (2 low, 1 moderate, 14 high, 0 critical), 524 dependency entries. |
| `npm ls --all --json` | 0 | No dependency-tree problems. |
| lockfile duplicate-version scan | 0 | Static scan found 97 package names represented by multiple versions (including 9 Wrangler versions, 3 esbuild versions, 2 Express versions). |
| installed-package license metadata scan | 0 | 343 installed package directories checked; all dependency package manifests had license metadata. Root application has no license field/license file. |
| client-bundle secret pattern scan | 0 | 63 client assets; zero hits for server secrets, `process.env`, or Supabase/QBO/Twilio/Resend secret names. |
| `npx supabase --version` | 0 | CLI available: 2.107.0. |
| `npx supabase status` | 1 | Environment-blocked: local Supabase container health inspection could not connect to Docker daemon. No `supabase start` or `db reset` attempted. |

## Migration hashes

34 SQL migrations were present (`0001`–`0034`) and individually SHA-256 hashed. The reproducible aggregate (sorted filename + NUL + bytes + NUL) is `f62c808ab34f7bd35306dd204bce2dc530cbe1710d0e70bf66bd5bb11fcb1069`; representative final entries: `0032_security_hardening.sql` `DB7BB88932B7EAF6D8358CC57C0F72DAD552297F2FEA51632C899A9BC6A38AAE`, `0033_text_message_phone_norm.sql` `3951D03102A7EBEEE7A2335337D2651DA3F6E8AA9108C1E1DF35B8E25AF6F9AA`, `0034_oauth_state_user_binding.sql` `EB2228C75860FA1F87F0C2B621BF046B5623B71BE0782DF41C1C800C306AE1F0`.

## Concerns

- The full test suite is not a pass: both attempts stopped in global setup because `.env.test` is absent. This is an environment/test-fixture block, not a product assertion.
- `npm audit` reports 14 high-severity vulnerabilities and the lockfile contains broad transitive version duplication; triage is required before release sign-off.
- Node and Cloudflare builds both pass, but the Cloudflare build emits an anomalous cancellation log while returning exit 0; retain this as a follow-up observation.
- Supabase integration/RLS tests and migration reset were not exercised because Docker/local Supabase was unavailable. No non-loopback database was contacted.
