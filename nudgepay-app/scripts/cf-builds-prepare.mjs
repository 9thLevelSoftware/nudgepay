// Used by the repo-root wrangler.toml [build] command when Cloudflare
// Workers Builds runs `npx wrangler deploy` from the Git repository root.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const nodeModules = new URL("../node_modules", import.meta.url);
if (!existsSync(nodeModules)) run("npm", ["ci"]);
run("npm", ["run", "build"]);
run("node", ["scripts/strip-build-dev-vars.mjs"]);
