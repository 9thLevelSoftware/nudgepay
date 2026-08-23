import { expect, test } from "vitest";
import { htmlToPlainText, inboundEmailBody } from "../app/lib/html-plain-text";
import { mapResendEvent } from "../app/lib/email-events";
import { readFileSync } from "node:fs";

test("htmlToPlainText strips tags, scripts, and decodes entities", () => {
  expect(htmlToPlainText("<p>Payment sent</p>")).toBe("Payment sent");
  expect(htmlToPlainText("<p>Hi</p><p>I'll pay Friday</p>")).toBe("Hi\nI'll pay Friday");
  expect(htmlToPlainText("<script>alert(1)</script><p>ok</p>")).toBe("ok");
  expect(htmlToPlainText("A&nbsp;B &amp; C")).toBe("A B & C");
  expect(htmlToPlainText("&#128512;")).toBe("😀");
  expect(htmlToPlainText("&#x1F600;")).toBe("😀");
  expect(htmlToPlainText("<br>line")).toBe("line");
});

test("inboundEmailBody prefers text and converts html-only", () => {
  expect(inboundEmailBody("plain", "<p>html</p>")).toBe("plain");
  expect(inboundEmailBody("", "<p>Payment sent</p>")).toBe("Payment sent");
  expect(inboundEmailBody("  ", "<p>Payment sent</p>")).toBe("Payment sent");
  expect(inboundEmailBody("", "")).toBe("");
});

test("mapResendEvent converts html-only inbound bodies", () => {
  expect(mapResendEvent({
    type: "email.received",
    data: { from: "c@x.com", to: "b@us.com", subject: "Re", html: "<p>Payment sent</p>", email_id: "in_html" },
  })).toMatchObject({ kind: "inbound", body: "Payment sent" });
});

test("webhook receiving fallback converts html-only fetched bodies", () => {
  const src = readFileSync(new URL("../app/routes/webhooks.resend.tsx", import.meta.url), "utf8");
  expect(src).toContain("inboundEmailBody(fetched.text, fetched.html)");
  expect(src).not.toContain("fetched.text || fetched.html");
});
