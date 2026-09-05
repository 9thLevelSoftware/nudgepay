import { createRequestHandler } from "react-router";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";
import { runScheduledDigest } from "../app/lib/digest-cron.server";
import { runScheduledRetention } from "../app/lib/retention-cron.server";
import { runScheduledProviderMonitor } from "../app/lib/provider-monitor.server";
import { CSP_REPORT_PATH, withSecurityHeaders } from "../app/lib/security-headers";
import { applyRequestBoundary } from "../app/lib/request-boundary";
import { logCspReport, shouldLogCspReport } from "../app/lib/log-redaction";
import { withUnhandledLogging } from "../app/lib/worker-observability";
import { alertFromWorkerError } from "../app/lib/operator-alert.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
			cspNonce: string;
			requestId: string;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

function createCspNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes));
}

function finalizeResponse(
	response: Response,
	requestId: string,
	cspMode: string | undefined,
	nonce: string,
	supabaseUrl: string | undefined,
): Response {
	const secured = withSecurityHeaders(response, { cspMode, nonce, supabaseUrl });
	const headers = new Headers(secured.headers);
	if (!headers.has("X-Request-Id")) headers.set("X-Request-Id", requestId);
	return new Response(secured.body, {
		status: secured.status,
		statusText: secured.statusText,
		headers,
	});
}

export default {
	async fetch(request, env, ctx) {
		const requestId = crypto.randomUUID();
		const nonce = createCspNonce();
		return withUnhandledLogging("fetch", {
			url: request.url,
			method: request.method,
			requestId,
		}, async () => {
			const boundary = await applyRequestBoundary(request);
			if (!boundary.ok) {
				return finalizeResponse(boundary.response, requestId, env.CSP_MODE, nonce, env.SUPABASE_URL);
			}

			const boundedRequest = boundary.request;
			const url = new URL(boundedRequest.url);
			if (boundedRequest.method === "POST" && url.pathname === CSP_REPORT_PATH) {
				if (shouldLogCspReport(requestId)) {
					try {
						logCspReport(await boundedRequest.json(), requestId);
					} catch {
						// Browser reports are advisory; malformed reports are acknowledged and ignored.
					}
				}
				return finalizeResponse(new Response(null, { status: 204 }), requestId, env.CSP_MODE, nonce, env.SUPABASE_URL);
			}

			const response = await requestHandler(boundedRequest, {
				cloudflare: { env, ctx, cspNonce: nonce, requestId },
			});
			return finalizeResponse(response, requestId, env.CSP_MODE, nonce, env.SUPABASE_URL);
		});
	},
	scheduled(controller, env, ctx) {
		const envRecord = env as unknown as Record<string, string>;
		const cron = controller.cron;
		const onError = async (err: unknown): Promise<void> => {
			await alertFromWorkerError(fetch, envRecord, { handler: "scheduled", err, cron });
		};
		if (cron === "0 * * * *") {
			// Hourly: digest gate (per-org local hour) + retention purge.
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledDigest(envRecord), { onError }),
			);
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledRetention(envRecord), { onError }),
			);
		} else if (cron === "*/5 * * * *") {
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledProviderMonitor(envRecord), { onError }),
			);
		} else {
			// Default: bounded CDC catch-up for all connected orgs.
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledCdc(envRecord), { onError }),
			);
		}
	},
} satisfies ExportedHandler<Env>;
