// Render cron entry — mirrors the "*/30 * * * *" branch of workers/app.ts `scheduled`.
// Bundled to dist-cron/cdc.js by scripts/build-cron.mjs.
import { runScheduledCdc } from "../app/lib/qbo-cron.server";

// This project is typed against @cloudflare/workers-types, which has no `process`
// global, and adding @types/node here would collide with the Workers lib types.
const proc = (globalThis as unknown as {
  process: {
    env: Record<string, string>;
    exitCode?: number;
    exit(code?: number): never;
  };
}).process;

runScheduledCdc(proc.env)
  .then((r) => {
    console.log("[cron] cdc", r);
    proc.exitCode = 0;
  })
  .catch((e) => {
    console.error("[cron] cdc failed", e);
    proc.exitCode = 1;
  })
  // Keep-alive sockets to Supabase/QBO/Resend can hold the event loop open long
  // after the work is done, which would stall the job until Render's timeout.
  .finally(() => proc.exit(proc.exitCode ?? 0));
