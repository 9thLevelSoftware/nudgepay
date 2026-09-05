// A Wrangler build hook runs before upload, so it cannot verify script-level
// observability settings after deployment. Cloudflare Workers Builds must use
// the repository's `npm run deploy` command, which performs that readback.
console.error(
  "Direct `npx wrangler deploy` from the repository root is disabled. Set the Cloudflare Workers Builds deploy command to `npm run deploy`.",
);
process.exitCode = 1;
