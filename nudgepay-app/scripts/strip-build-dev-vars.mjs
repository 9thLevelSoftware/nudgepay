// Cloudflare / `npm run deploy` must not upload local `.dev.vars` that the
// Vite plugin copies into build/server/.
import { existsSync, unlinkSync } from "node:fs";

const target = new URL("../build/server/.dev.vars", import.meta.url);
if (existsSync(target)) unlinkSync(target);
