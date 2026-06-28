// One-off: print a valid unsubscribe token for the Summit demo customer, signed
// with the local UNSUBSCRIBE_SECRET, so the walkthrough can show the real
// CAN-SPAM confirm page. Run from nudgepay-app/: node scripts/demo-unsub-token.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SECRET = "local-demo-unsubscribe-secret"; // mirrors .dev.vars

function b64url(s) { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function hmac(secret, dataStr) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataStr));
  let s = ""; for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data: org } = await svc.from("organizations").select("id").eq("name", "Chancey Heating & Cooling").single();
const { data: cust } = await svc.from("customers").select("id").eq("org_id", org.id).eq("name", "Summit Restaurant Group").single();
const payload = b64url(JSON.stringify({ o: org.id, c: cust.id }));
const token = `${payload}.${await hmac(SECRET, payload)}`;
console.log(token);
