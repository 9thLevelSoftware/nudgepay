import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// NP-AUD-2026-040: GHSA-49rj-9fvp-4h2h (turbo-stream RCE) and
// GHSA-h5cw-625j-3rxh (action CSRF) affect react-router <= 7.11.0.
const MIN_PATCHED = [7, 12, 0] as const;
const PACKAGES = ["react-router", "@react-router/dev", "@react-router/express"] as const;

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`unparseable version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const [maj, minr, pat] = parseSemver(version);
  if (maj !== min[0]) return maj > min[0];
  if (minr !== min[1]) return minr > min[1];
  return pat >= min[2];
}

describe("react-router advisory pins (NP-AUD-2026-040)", () => {
  it("package.json pins react-router packages past the GHSA-affected range", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const pins = {
      "react-router": pkg.dependencies["react-router"],
      "@react-router/express": pkg.dependencies["@react-router/express"],
      "@react-router/dev": pkg.devDependencies["@react-router/dev"],
    };
    for (const [name, pin] of Object.entries(pins)) {
      expect(pin, name).toBeTruthy();
      expect(isAtLeast(pin, MIN_PATCHED), `${name}@${pin} still in <=7.11.0`).toBe(true);
    }
  });

  it("installed packages resolve to the same patched major.minor.patch", () => {
    for (const name of PACKAGES) {
      const installed = require(`${name}/package.json`) as { version: string };
      expect(
        isAtLeast(installed.version, MIN_PATCHED),
        `${name}@${installed.version} still in <=7.11.0`,
      ).toBe(true);
      expect(installed.version.startsWith("7."), `${name} drifted off 7.x`).toBe(true);
    }
    expect(require.resolve("react-router", { paths: [appRoot] })).toContain("node_modules");
  });
});
