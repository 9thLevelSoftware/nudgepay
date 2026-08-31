import { createRequestHandler } from "react-router";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";
import { runScheduledDigest } from "../app/lib/digest-cron.server";
import { runScheduledRetention } from "../app/lib/retention-cron.server";
import { withSecurityHeaders } from "../app/lib/security-headers";
import { withUnhandledLogging } from "../app/lib/worker-observability";
import { alertFromWorkerError } from "../app/lib/operator-alert.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env, ctx) {
		return withUnhandledLogging("fetch", { url: request.url }, async () => {
			const response = await requestHandler(request, {
				cloudflare: { env, ctx },
			});
			return withSecurityHeaders(response);
		});
	},
	scheduled(controller, env, ctx) {
		const envRecord = env as unknown as Record<string, string>;
		const cron = controller.cron;
		const onError = (err: unknown) =>
			alertFromWorkerError(fetch, envRecord, { handler: "scheduled", err, cron }).then(() => undefined);
		if (cron === "0 * * * *") {
			// Hourly: digest gate (per-org local hour) + retention purge.
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledDigest(envRecord), { onError }),
			);
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledRetention(envRecord), { onError }),
			);
		} else {
			// Default: bounded CDC catch-up for all connected orgs.
			ctx.waitUntil(
				withUnhandledLogging("scheduled", { cron }, () => runScheduledCdc(envRecord), { onError }),
			);
		}
	},
} satisfies ExportedHandler<Env>;
