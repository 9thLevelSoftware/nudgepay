// Bundles the Render cron entry points (cron/*.ts) into runnable Node ESM.
//
// Output goes to dist-cron/, NOT build/ — `react-router build` rm -rf's the whole
// build/ directory on every run, which would delete these.
//
// `packages: "external"` leaves bare imports to be resolved from node_modules at
// runtime. Today the cron import graph reaches only @supabase/supabase-js and
// @supabase/ssr, both in "dependencies". Everything else is a relative import under
// app/lib. NOTE: app/lib currently uses no "~/" path aliases — if one is introduced,
// this build will fail to resolve it and will need an esbuild alias config.
import { build } from "esbuild";

const entries = ["cron/cdc.ts", "cron/digest.ts"];

await build({
	entryPoints: entries,
	outdir: "dist-cron",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	packages: "external",
	sourcemap: true,
	logLevel: "info",
});

console.log(`[build-cron] bundled ${entries.length} entries -> dist-cron/`);
