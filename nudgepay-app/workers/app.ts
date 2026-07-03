import { createRequestHandler } from "react-router";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";
import { runScheduledDigest } from "../app/lib/digest-cron.server";

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
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
	scheduled(controller, env, ctx) {
		const envRecord = env as unknown as Record<string, string>;
		if (controller.cron === "0 * * * *") {
			// Hourly digest gate — each org fires once local time reaches its
			// configured digest_hour_local (see digest-cron.server.ts).
			ctx.waitUntil(runScheduledDigest(envRecord));
		} else {
			// Default: bounded CDC catch-up for all connected orgs.
			ctx.waitUntil(runScheduledCdc(envRecord));
		}
	},
} satisfies ExportedHandler<Env>;
