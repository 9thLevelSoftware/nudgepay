// Production/staging Worker deploy. The Vite Cloudflare plugin copies
// `.dev.vars` into build/server/; wrangler then overrides toml vars with
// local Supabase. Strip that file before upload.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const staging = process.argv.includes("--staging");
const cwd = new URL("..", import.meta.url);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "build"]);
run("node", ["scripts/strip-build-dev-vars.mjs"]);

if (!staging) {
  run("npx", ["wrangler", "deploy", "--env="]);
  process.exit(0);
}

const src = new URL("../build/server/wrangler.json", import.meta.url);
const dest = new URL("../build/server/wrangler.staging.json", import.meta.url);
const cfg = JSON.parse(readFileSync(src, "utf8"));
cfg.name = "nudgepay-app-staging";
cfg.vars = { ...cfg.vars, QBO_SANDBOX: "true" };
cfg.routes = [];
if (cfg.ratelimits?.[0]) cfg.ratelimits[0].namespace_id = "1002";
writeFileSync(dest, JSON.stringify(cfg));
run("npx", ["wrangler", "deploy", "-c", "build/server/wrangler.staging.json"]);
