import { chromium } from "playwright";

const TARGET = process.env.URL || "http://localhost:5173/";
const out = new URL("../demo-recording/frontend-screenshot.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const msgs = [], errors = [];
page.on("console", (m) => msgs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let status = "ERR";
try {
  const resp = await page.goto(TARGET, { waitUntil: "networkidle", timeout: 20000 });
  status = resp ? resp.status() : "no-response";
} catch (e) {
  status = "GOTO_ERR: " + e.message;
}
await page.waitForTimeout(2500);

const title = await page.title().catch(() => "");
const rootChildren = await page.locator("#root > *").count().catch(() => 0);
const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700);
await page.screenshot({ path: out }).catch((e) => console.log("screenshot err", e.message));

console.log(JSON.stringify({ status, title, rootChildren, bodyTextPreview: bodyText }, null, 2));
console.log("\n--- console (first 20) ---\n" + msgs.slice(0, 20).join("\n"));
console.log("\n--- page errors ---\n" + (errors.join("\n") || "(none)"));
console.log("\nSCREENSHOT: " + out);

await browser.close();
