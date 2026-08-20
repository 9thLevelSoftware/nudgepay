// Render cron entry — mirrors the "0 * * * *" (digest gate) branch of workers/app.ts `scheduled`.
// Bundled to dist-cron/digest.js by scripts/build-cron.mjs.
import { runScheduledDigest } from "../app/lib/digest-cron.server";

// This project is typed against @cloudflare/workers-types, which has no `process`
// global, and adding @types/node here would collide with the Workers lib types.
const proc = (globalThis as unknown as {
  process: {
    env: Record<string, string>;
    exitCode?: number;
    exit(code?: number): never;
  };
}).process;

runScheduledDigest(proc.env)
  .then((r) => {
    console.log("[cron] digest", r);
    proc.exitCode = 0;
  })
  .catch((e) => {
    console.error("[cron] digest failed", e);
    proc.exitCode = 1;
  })
  // Keep-alive sockets to Supabase/QBO/Resend can hold the event loop open long
  // after the work is done, which would stall the job until Render's timeout.
  .finally(() => proc.exit(proc.exitCode ?? 0));
