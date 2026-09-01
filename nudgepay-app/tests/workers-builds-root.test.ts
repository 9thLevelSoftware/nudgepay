import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Cloudflare Workers Builds at repo root", () => {
  it("has a root wrangler config so deploys do not auto-init from netlify/", () => {
    const toml = read("../../wrangler.toml");
    expect(toml).toContain('name = "nudgepay-app"');
    expect(toml).toContain('cwd = "nudgepay-app"');
    expect(toml).toContain("cf-builds-prepare");
    expect(toml).toContain("no_bundle = true");
    expect(toml).not.toMatch(/directory\s*=\s*"netlify"/);
    expect(toml).toContain("nudgepay-app/build/server/index.js");
    const rootPkg = JSON.parse(read("../../package.json"));
    expect(rootPkg.scripts.postinstall).toContain("cf-root-postinstall");
    const postinstall = read("../../scripts/cf-root-postinstall.mjs");
    expect(postinstall).toMatch(/WORKERS_CI/);
    expect(postinstall).toMatch(/process\.env\.CI/);
    const prepare = read("../scripts/cf-builds-prepare.mjs");
    expect(prepare).toMatch(/CI:\s*"true"/);
    expect(prepare).toContain("WORKERS_CI");
    const appPkg = JSON.parse(read("../package.json"));
    const plugin = String(appPkg.devDependencies["@cloudflare/vite-plugin"]);
    const [, minor] = plugin.replace(/^[^\d]*/, "").split(".").map(Number);
    expect(minor, "vite-plugin 1.25+ skips the WebSocket-during-build assertion").toBeGreaterThanOrEqual(25);
  });

  it("legacy Netlify redirects stay Netlify-only and are not a Worker asset dir", () => {
    const redirects = read("../../netlify/_redirects");
    expect(redirects).toContain("Do not deploy this directory as a Cloudflare Worker");
    expect(redirects).toContain("301!");
  });
});
