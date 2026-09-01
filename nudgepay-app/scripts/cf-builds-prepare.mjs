// Prepares the Workers build output. Always cwd to this package, even when
// invoked from the repo-root postinstall (Cloudflare Workers Builds).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
      NODE_ENV: "production",
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const built = new URL("../build/server/index.js", import.meta.url);
// Workers Builds: postinstall already compiled the app. Do not rebuild as a
// child of `wrangler deploy` — that trips the Vite plugin WebSocket assertion
// on @cloudflare/vite-plugin < 1.25.
const inCi =
  process.env.WORKERS_CI === "1" ||
  process.env.CI === "true" ||
  process.env.CI === "1";
if (inCi && existsSync(built)) process.exit(0);

const nodeModules = new URL("../node_modules", import.meta.url);
if (!existsSync(nodeModules)) run("npm", ["ci"]);
run("npm", ["run", "build"]);
run("node", ["scripts/strip-build-dev-vars.mjs"]);
