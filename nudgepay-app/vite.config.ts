import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Two deploy targets share this config:
//   - Cloudflare Workers (primary)  — wrangler.toml, `npm run build` / `npm run deploy`
//   - Node / Render     (secondary) — render.yaml sets BUILD_TARGET=node, `npm start`
//
// The Cloudflare plugin overrides the SSR rollup input to point at workers/app.ts and
// emits build/server/wrangler.json. Dropping it lets React Router fall back to its own
// virtual server build, which is what server.js loads from build/server/index.js.
//
// If BUILD_TARGET=node leaks into a Workers build, `wrangler deploy` fails immediately
// because build/server/wrangler.json is never written.
const isNodeBuild = process.env.BUILD_TARGET === "node";

export default defineConfig({
	plugins: [
		...(isNodeBuild ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
	],
});
