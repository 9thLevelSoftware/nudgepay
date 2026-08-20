import { createRequestHandler } from "@react-router/express";
import express from "express";
import path from "node:path";

// Node/Render entry point. The Cloudflare Worker equivalent is workers/app.ts.
// Both hand routes the same load context shape, so app/lib/env.server.ts and every
// `getEnv(context as any)` call site work unchanged on either runtime.
const build = await import("./build/server/index.js");

const here = import.meta.dirname;
const clientDir = path.join(here, "build", "client");

const app = express();

// REQUIRED behind Render's TLS-terminating proxy.
// app/lib/csrf.server.ts derives the expected origin from `new URL(request.url).origin`,
// and @react-router/express builds that URL from `req.protocol`. Without trust proxy
// req.protocol is "http" while the browser sends `Origin: https://…`, so requireSameOrigin
// (app/lib/session.server.ts) rejects every POST/PUT/PATCH/DELETE with 403.
app.set("trust proxy", true);
app.disable("x-powered-by");

// Deliberately NO express.json() / express.urlencoded().
// The four /webhooks/* routes call `await request.text()` to verify HMAC signatures
// (Intuit, Resend, Twilio inbound + status). A body parser drains the stream, so
// request.text() returns "" and every signature check fails. Do not add one.

// build/client is: assets/ (content-hashed) + favicon.ico (not hashed).
app.use(
	"/assets",
	express.static(path.join(clientDir, "assets"), {
		immutable: true,
		maxAge: "1y",
		index: false,
	}),
);
app.use(
	express.static(clientDir, {
		maxAge: "1h",
		index: false,
		dotfiles: "ignore",
	}),
);

// app.use() with no path is the only catch-all valid on both Express 4 and 5.
// Bare "*" throws on Express 5 (path-to-regexp v8); "/*splat" breaks on Express 4.
app.use(
	createRequestHandler({
		build,
		getLoadContext: () => ({
			cloudflare: {
				env: process.env,
				ctx: {
					waitUntil: (p) => void Promise.resolve(p).catch(console.error),
					passThroughOnException: () => {},
				},
			},
		}),
	}),
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	console.log(`[server] listening on :${port}`);
});
