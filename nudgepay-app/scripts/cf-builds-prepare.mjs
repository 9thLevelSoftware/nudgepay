// Prepares the Workers build output. Always cwd to this package, even when
// Wrangler [build] is invoked from the repository root.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
      ...extraEnv,
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const nodeModules = new URL("../node_modules", import.meta.url);
if (!existsSync(nodeModules)) {
  // NODE_ENV=production makes npm omit=dev; react-router/vite live in
  // devDependencies. --include=dev matches render.yaml's production install.
  run("npm", ["ci", "--include=dev"]);
}
run("npm", ["run", "build"], { NODE_ENV: "production" });
run("node", ["scripts/strip-build-dev-vars.mjs"]);
