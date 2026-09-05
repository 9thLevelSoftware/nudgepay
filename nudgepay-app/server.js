import { createRequestHandler } from "react-router";
import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Node/Render entry point. The Cloudflare Worker equivalent is workers/app.ts.
// Both hand routes the same load context shape, so app/lib/env.server.ts and every
// `getEnv(context as any)` call site work unchanged on either runtime.
const build = await import("./build/server/index.js");

const here = import.meta.dirname;
const clientDir = path.join(here, "build", "client");

const app = express();
const requestHandler = createRequestHandler(build, process.env.NODE_ENV);

const CSP_REPORT_PATH = "/__csp-report";
const APP_BODY_LIMIT_BYTES = 256 * 1024;
const CSP_REPORT_BODY_LIMIT_BYTES = 64 * 1024;
const PROVIDER_WEBHOOK_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const CSP_MODE = process.env.CSP_MODE === "enforce" ? "enforce" : "report-only";
const THEME_BOOTSTRAP_HASH = "'sha256-k/WeqlU+P1OMnGy0Wr3QmHYLyxHHENjrrNHJgBXSVQU='";

const WEBHOOK_MEDIA_TYPES = new Map([
	["/webhooks/qbo", ["application/json"]],
	["/webhooks/resend", ["application/json"]],
	["/webhooks/stripe", ["application/json"]],
	["/webhooks/twilio/inbound", ["application/x-www-form-urlencoded"]],
	["/webhooks/twilio/status", ["application/x-www-form-urlencoded"]],
]);

function createCspNonce() {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

function configuredSupabaseConnectSources(value) {
	if (!value) return [];
	try {
		const url = new URL(value);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
			return [];
		}
		const websocketUrl = new URL(url.origin);
		websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return [url.origin, websocketUrl.origin];
	} catch {
		return [];
	}
}

function cspPolicy(nonce) {
	const connectSources = [
		"'self'",
		...configuredSupabaseConnectSources(process.env.SUPABASE_URL),
	];
	return [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://appcenter.intuit.com",
		`script-src 'self' 'nonce-${nonce}' ${THEME_BOOTSTRAP_HASH}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		`connect-src ${connectSources.join(" ")}`,
		`report-uri ${CSP_REPORT_PATH}`,
	].join("; ");
}

const SAFE_ERROR_NAMES = new Set([
	"Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError",
	"ProviderSendRejectedError", "ProviderResponseAmbiguousError", "AmbiguousSendError",
	"QboTokenRequestError",
]);

function safeErrorDetails(error) {
	const candidateName = error && typeof error === "object" && typeof error.name === "string"
		? error.name : undefined;
	const errorName = candidateName && SAFE_ERROR_NAMES.has(candidateName) ? candidateName : "UnknownError";
	const candidateCode = error && typeof error === "object" ? error.code : undefined;
	const errorCode = typeof candidateCode === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(candidateCode)
		? candidateCode : undefined;
	const candidateStatus = error && typeof error === "object" ? error.status ?? error.statusCode : undefined;
	const status = typeof candidateStatus === "number" && Number.isInteger(candidateStatus)
		&& candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : undefined;
	return { errorName, ...(errorCode ? { errorCode } : {}), ...(status ? { status } : {}) };
}

function redactSensitivePath(pathname) {
	return pathname.replace(/^(\/accept\/)[^/]+/i, "$1[REDACTED]");
}

function safeCspUri(value) {
	if (typeof value !== "string") return undefined;
	if (["inline", "eval", "wasm-eval", "self", "data", "blob"].includes(value)) return value;
	try {
		const url = new URL(value);
		if (url.protocol === "data:") return "data";
		if (url.protocol === "blob:") return "blob";
		if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return "[invalid-url]";
		return `${url.origin}${redactSensitivePath(url.pathname)}`.slice(0, 512);
	} catch {
		return "[invalid-url]";
	}
}

function safeCspDirective(value) {
	const directive = typeof value === "string" ? value.trim().split(/\s+/, 1)[0]?.toLowerCase() : undefined;
	return directive && /^[a-z][a-z0-9-]{0,63}$/.test(directive) ? directive : undefined;
}

function shouldLogCspReport(requestId) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < requestId.length; i += 1) {
		hash ^= requestId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) % 16 === 0;
}

function logCspReport(payload, requestId) {
	if (!payload || typeof payload !== "object") return;
	const candidate = payload["csp-report"] ?? payload;
	if (!candidate || typeof candidate !== "object") return;
	console.warn({
		event: "csp_violation",
		requestId,
		documentUri: safeCspUri(candidate["document-uri"]),
		blockedUri: safeCspUri(candidate["blocked-uri"]),
		violatedDirective: safeCspDirective(candidate["violated-directive"]),
		effectiveDirective: safeCspDirective(candidate["effective-directive"]),
		disposition: candidate.disposition === "report" || candidate.disposition === "enforce"
			? candidate.disposition : undefined,
	});
}

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
	const requestId = crypto.randomUUID();
	const nonce = createCspNonce();
	res.locals.requestId = requestId;
	res.locals.cspNonce = nonce;
	if (CSP_MODE === "enforce") {
		res.setHeader("Content-Security-Policy", cspPolicy(nonce));
	} else {
		res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
		res.setHeader("Content-Security-Policy-Report-Only", cspPolicy(nonce));
	}
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	res.setHeader("X-Request-Id", requestId);
	if (publicBase && publicBase.startsWith("https:")) {
		res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
	next();
});

// Deliberately NO express.json() / express.urlencoded(). The catch-all below
// reads a bounded byte buffer and builds the Fetch Request itself so signed
// webhook routes receive the exact bytes used by provider HMAC verification.

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

function requestPolicy(pathname) {
	if (pathname === CSP_REPORT_PATH) {
		return {
			limitBytes: CSP_REPORT_BODY_LIMIT_BYTES,
			mediaTypes: ["application/csp-report", "application/reports+json", "application/json"],
		};
	}
	const webhookTypes = WEBHOOK_MEDIA_TYPES.get(pathname);
	if (webhookTypes) return { limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES, mediaTypes: webhookTypes };
	return {
		limitBytes: APP_BODY_LIMIT_BYTES,
		mediaTypes: ["application/x-www-form-urlencoded", "multipart/form-data", "application/json"],
	};
}

function parsedContentLength(req) {
	const value = req.get("content-length");
	if (value === undefined) return null;
	if (!/^\d+$/.test(value)) return "invalid";
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function readBoundedBody(req, limitBytes) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		let settled = false;
		const cleanup = () => {
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
			req.off("aborted", onAborted);
		};
		const finish = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		const onData = (chunk) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			total += bytes.byteLength;
			if (total > limitBytes) {
				finish(null);
				req.resume();
				return;
			}
			chunks.push(bytes);
		};
		const onEnd = () => finish(Buffer.concat(chunks, total));
		const onError = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onAborted = () => onError(new Error("request aborted"));
		req.on("data", onData);
		req.on("end", onEnd);
		req.on("error", onError);
		req.on("aborted", onAborted);
	});
}

function requestHeaders(req) {
	const headers = new Headers();
	for (let i = 0; i < req.rawHeaders.length; i += 2) {
		headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
	}
	return headers;
}

function requestUrl(req) {
	const forwardedPort = req.app.enabled("trust proxy")
		? req.get("x-forwarded-host")?.split(":")[1]
		: undefined;
	const hostPort = req.get("host")?.split(":")[1];
	const parsedPort = Number.parseInt(forwardedPort ?? hostPort ?? "", 10);
	const port = Number.isSafeInteger(parsedPort) ? `:${parsedPort}` : "";
	const hostname = req.hostname.split(/[\\/?#@]/)[0] || "localhost";
	return new URL(`${req.protocol}://${hostname}${port}${req.originalUrl}`);
}

async function sendResponse(res, response) {
	res.statusMessage = response.statusText;
	res.status(response.status);
	for (const [key, value] of response.headers.entries()) res.append(key, value);
	if (!response.body) {
		res.end();
		return;
	}
	await pipeline(Readable.fromWeb(response.body), res);
}

// app.use() with no path is the only catch-all valid on both Express 4 and 5.
app.use(async (req, res, next) => {
	try {
		const url = requestUrl(req);
		const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
		let body;
		if (mutating) {
			const policy = requestPolicy(url.pathname);
			const length = parsedContentLength(req);
			if (length === "invalid") {
				res.status(400).type("text/plain").send("invalid content-length");
				return;
			}
			if (length !== null && length > policy.limitBytes) {
				res.status(413).type("text/plain").send("payload too large");
				return;
			}
			const hasBody = (length !== null && length > 0) || req.get("transfer-encoding") !== undefined;
			const type = req.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
			if (hasBody && (!type || !policy.mediaTypes.includes(type))) {
				res.status(415).type("text/plain").send("unsupported media type");
				return;
			}
			body = hasBody ? await readBoundedBody(req, policy.limitBytes) : Buffer.alloc(0);
			if (body === null) {
				res.status(413).type("text/plain").send("payload too large");
				return;
			}
		}

		if (req.method === "POST" && url.pathname === CSP_REPORT_PATH) {
			if (shouldLogCspReport(res.locals.requestId)) {
				try { logCspReport(JSON.parse(body.toString("utf8")), res.locals.requestId); } catch {}
			}
			res.status(204).end();
			return;
		}

		const controller = new AbortController();
		res.on("close", () => controller.abort());
		const init = { method: req.method, headers: requestHeaders(req), signal: controller.signal };
		if (mutating && body.byteLength > 0) {
			init.body = body;
			init.duplex = "half";
		}
		const response = await requestHandler(new Request(url, init), {
			cloudflare: {
				env: process.env,
				ctx: { waitUntil, passThroughOnException: () => {} },
				cspNonce: res.locals.cspNonce,
				requestId: res.locals.requestId,
			},
		});
		await sendResponse(res, response);
	} catch (error) {
		next(error);
	}
});

app.use((error, req, res, _next) => {
	console.error({
		event: "unhandled_node_request_error",
		requestId: res.locals.requestId,
		method: req.method,
		path: redactSensitivePath(req.path),
		...safeErrorDetails(error),
	});
	if (!res.headersSent) res.status(500).type("text/plain").send("Internal Server Error");
});

const pending = new Set();
function waitUntil(p) {
	const wrapped = Promise.resolve(p).catch((err) => {
		console.error({
			event: "node_wait_until_error",
			...safeErrorDetails(err),
		});
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
