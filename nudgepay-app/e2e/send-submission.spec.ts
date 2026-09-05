import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { deriveInitialSubmissionId, submissionStorageKey } from "../app/lib/send-submission";

const SEED_1 = "018f0f4d-77c2-7a0a-9a73-4c44fb6c5912";
const SEED_2 = "018f0f4d-77c2-7a0a-9a73-4c44fb6c5913";
const SEED_3 = "018f0f4d-77c2-7a0a-9a73-4c44fb6c5914";
const BASE = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  channel: "sms" as const,
  customerId: "33333333-3333-4333-8333-333333333333",
};

async function browserHarness(): Promise<string> {
  const output = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { useSendSubmission } from "./app/lib/use-send-submission.ts";

        let root = null;
        function Harness(props) {
          const submission = useSendSubmission(props);
          return React.createElement("form", {
            onSubmit(event) {
              submission.onSubmit(event);
              window.submitPrevented = event.defaultPrevented;
              if (!event.defaultPrevented) {
                window.lastSerialized = Object.fromEntries(new FormData(event.currentTarget));
              }
              event.preventDefault();
            },
          },
            React.createElement("input", {
              ref: submission.inputRef,
              type: "hidden",
              name: "submissionId",
              value: submission.submissionId,
              readOnly: true,
            }),
            React.createElement("input", { type: "hidden", name: "invoiceId", value: "invoice-1" }),
            React.createElement("textarea", { name: "body", defaultValue: props.initialBody }),
            React.createElement("button", { type: "submit", disabled: !submission.ready }, "Send"),
            submission.error ? React.createElement("p", { role: "alert" }, submission.error) : null,
          );
        }
        window.mountHarness = (props) => {
          if (root) root.unmount();
          const host = document.getElementById("root");
          host.replaceChildren();
          root = createRoot(host);
          root.render(React.createElement(Harness, props));
        };
        window.rerenderHarness = (props) => root.render(React.createElement(Harness, props));
      `,
      resolveDir: process.cwd(),
      sourcefile: "send-submission-browser-harness.js",
      loader: "js",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    define: { "process.env.NODE_ENV": '"test"' },
  });
  return output.outputFiles[0].text;
}

test("send form preserves retries across reload, rotates edits, and correlates success", async ({ page }) => {
  const harness = await browserHarness();
  await page.route("http://localhost:41777/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><div id="root"></div><script>${harness}</script>`,
    });
  });
  await page.goto("http://localhost:41777/");

  const props = { ...BASE, serverSeed: SEED_1, result: null, initialBody: "Hello" };
  const firstId = deriveInitialSubmissionId(SEED_1, `${BASE.userId}:${BASE.orgId}:${BASE.channel}:${BASE.customerId}`);
  await page.evaluate((value) => (window as any).mountHarness(value), props);
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(firstId);

  await page.getByRole("button", { name: "Send" }).click();
  expect(await page.evaluate(() => (window as any).lastSerialized.submissionId)).toBe(firstId);

  await page.evaluate((value) => (window as any).mountHarness(value), { ...props, serverSeed: SEED_2 });
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(firstId);
  await page.getByRole("button", { name: "Send" }).click();
  expect(await page.evaluate(() => (window as any).lastSerialized.submissionId)).toBe(firstId);

  await page.locator('textarea[name="body"]').fill("Edited message");
  await page.getByRole("button", { name: "Send" }).click();
  const editedId = await page.evaluate(() => (window as any).lastSerialized.submissionId as string);
  expect(editedId).not.toBe(firstId);

  await page.evaluate((value) => (window as any).rerenderHarness(value), {
    ...props, serverSeed: SEED_2, result: { id: firstId, success: true },
  });
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(editedId);

  await page.evaluate((value) => (window as any).rerenderHarness(value), {
    ...props, serverSeed: SEED_2, result: { id: editedId, success: true },
  });
  await expect(page.locator('input[name="submissionId"]')).not.toHaveValue(editedId);
  const freshId = await page.locator('input[name="submissionId"]').inputValue();
  const storageKey = submissionStorageKey(BASE);
  expect(JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), storageKey))!))
    .toEqual({ id: freshId, payloadKey: null });

  // A composer remount in the same document retains the fresh generation.
  await page.evaluate((value) => (window as any).mountHarness(value), {
    ...props, serverSeed: SEED_1, result: null,
  });
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(freshId);

  // A full reload has a new server seed, but the per-scope fresh generation
  // survives. A stale success result cannot advance it again.
  await page.evaluate((value) => (window as any).mountHarness(value), {
    ...props, serverSeed: SEED_3, result: { id: editedId, success: true },
  });
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(freshId);
});

test("a full-document success redirect rotates the persisted submitted identity", async ({ page }) => {
  const harness = await browserHarness();
  await page.route("http://localhost:41777/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><div id="root"></div><script>${harness}</script>`,
    });
  });
  await page.goto("http://localhost:41777/");

  const props = { ...BASE, serverSeed: SEED_1, result: null, initialBody: "Hello" };
  await page.evaluate((value) => (window as any).mountHarness(value), props);
  await page.getByRole("button", { name: "Send" }).click();
  const sentId = await page.evaluate(() => (window as any).lastSerialized.submissionId as string);

  // A raw form redirect hydrates a new document with a new root seed. The
  // scoped pending value, rather than component-local state, correlates it.
  await page.evaluate((value) => (window as any).mountHarness(value), {
    ...props, serverSeed: SEED_2, result: { id: sentId, success: true },
  });
  await expect(page.locator('input[name="submissionId"]')).not.toHaveValue(sentId);
  const nextId = await page.locator('input[name="submissionId"]').inputValue();

  await page.evaluate((value) => (window as any).mountHarness(value), {
    ...props, serverSeed: SEED_3, result: null,
  });
  await expect(page.locator('input[name="submissionId"]')).toHaveValue(nextId);
});

test("storage denial prevents the send request", async ({ page }) => {
  const harness = await browserHarness();
  await page.route("http://localhost:41777/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><div id="root"></div><script>${harness}</script>`,
    });
  });
  await page.goto("http://localhost:41777/");
  await page.evaluate(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("denied", "SecurityError"); },
    });
  });
  const props = { ...BASE, serverSeed: SEED_1, result: null, initialBody: "Hello" };
  await page.evaluate((value) => (window as any).mountHarness(value), props);
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(/session storage/i);
  await page.locator("form").evaluate((form) => form.dispatchEvent(new SubmitEvent("submit", {
    bubbles: true, cancelable: true,
  })));
  expect(await page.evaluate(() => (window as any).submitPrevented)).toBe(true);
  expect(await page.evaluate(() => (window as any).lastSerialized)).toBeUndefined();
});
