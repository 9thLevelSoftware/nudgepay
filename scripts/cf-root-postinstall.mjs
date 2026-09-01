// Cloudflare Workers Builds runs install at the repo root, then
// `npx wrangler deploy`. Compile the app here (not as a Wrangler [build]
// child) so React Router's nested Vite server does not hit
// @cloudflare/vite-plugin's "WebSocket is undefined" assertion.
//
// Gate on WORKERS_CI *or* CI: the install phase has not always exported
// WORKERS_CI=1, and GitHub Actions only `npm ci`s inside nudgepay-app/.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isOn = (v) => v === "1" || v === "true";
if (!isOn(process.env.WORKERS_CI) && !isOn(process.env.CI)) process.exit(0);

const script = fileURLToPath(
  new URL("../nudgepay-app/scripts/cf-builds-prepare.mjs", import.meta.url),
);
const r = spawnSync(process.execPath, [script], {
  stdio: "inherit",
  env: { ...process.env, CI: "true", NODE_ENV: "production" },
});
process.exit(r.status ?? 1);
