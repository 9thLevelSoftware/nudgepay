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
// Bound to one hop so a client-supplied X-Forwarded-* chain cannot mint origin.
app.set("trust proxy", 1);
app.disable("x-powered-by");

const publicBase = process.env.APP_PUBLIC_BASE_URL;
if (publicBase) {
	let allowedHost = "";
	try { allowedHost = new URL(publicBase).hostname; } catch { allowedHost = ""; }
	if (allowedHost) {
		app.use((req, res, next) => {
			if (req.hostname !== allowedHost) {
				res.status(400).type("text/plain").send("invalid host");
				return;
			}
			next();
		});
	}
}

app.use((_req, res, next) => {
	res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	if (publicBase && publicBase.startsWith("https:")) {
		res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
	next();
});

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
					waitUntil,
					passThroughOnException: () => {},
				},
			},
		}),
	}),
);

const pending = new Set();
function waitUntil(p) {
	const wrapped = Promise.resolve(p).catch((err) => {
		console.error("[waitUntil]", err);
	});
	pending.add(wrapped);
	wrapped.finally(() => pending.delete(wrapped));
}

async function drain(timeoutMs = 9_000) {
	if (pending.size === 0) return;
	const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
	await Promise.race([Promise.allSettled([...pending]), timeout]);
}

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
	console.log(`[server] listening on :${port}`);
});

function shutdown(signal) {
	console.log(`[server] ${signal}; draining background work`);
	server.close(async () => {
		await drain();
		process.exit(0);
	});
	setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
