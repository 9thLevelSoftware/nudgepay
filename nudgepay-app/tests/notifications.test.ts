import { test, expect } from "vitest";
import { brokenPromiseEmail, digestEmail } from "../app/lib/notifications";

// ---------------------------------------------------------------------------
// brokenPromiseEmail
// ---------------------------------------------------------------------------

test("broken promise email has correct subject", () => {
  const result = brokenPromiseEmail({
    customerName: "Acme Corp",
    promisedAmount: 1500,
    promisedDate: "2026-07-01",
    appUrl: "https://app.nudgepay.com",
  });
  expect(result.subject).toBe("Broken promise: Acme Corp — $1,500.00");
  expect(result.html).toContain("Acme Corp");
  expect(result.html).toContain("$1,500.00");
  expect(result.html).toContain("2026-07-01");
  expect(result.html).toContain("https://app.nudgepay.com/dashboard?view=broken-promises");
  expect(result.html).toContain("Settings");
});

test("broken promise email escapes HTML in customer name", () => {
  const result = brokenPromiseEmail({
    customerName: "<script>alert('xss')</script>",
    promisedAmount: 100,
    promisedDate: "2026-07-01",
    appUrl: "https://app.nudgepay.com",
  });
  expect(result.html).not.toContain("<script>");
  expect(result.html).toContain("&lt;script&gt;");
});

// ---------------------------------------------------------------------------
// digestEmail
// ---------------------------------------------------------------------------

test("digest email has correct subject with count", () => {
  const result = digestEmail({
    recipientName: "Jane Smith",
    assignedCases: [
      { customerName: "Acme Corp", totalOverdue: 5000, nextActionAt: "2026-07-02" },
      { customerName: "Beta Inc", totalOverdue: 2000, nextActionAt: "2026-07-02" },
    ],
    unassignedCases: [],
    appUrl: "https://app.nudgepay.com",
    today: "2026-07-02",
  });
  expect(result.subject).toBe("Follow-ups due today (2 accounts)");
  expect(result.html).toContain("Jane Smith");
  expect(result.html).toContain("Acme Corp");
  expect(result.html).toContain("Beta Inc");
  expect(result.html).toContain("https://app.nudgepay.com/dashboard?view=follow-ups-due");
});

test("digest email handles single account", () => {
  const result = digestEmail({
    recipientName: "Jane",
    assignedCases: [{ customerName: "Solo", totalOverdue: 100, nextActionAt: "2026-07-02" }],
    unassignedCases: [],
    appUrl: "https://app.nudgepay.com",
    today: "2026-07-02",
  });
  expect(result.subject).toBe("Follow-ups due today (1 account)");
});

test("digest email includes unassigned section for owners", () => {
  const result = digestEmail({
    recipientName: "Owner",
    assignedCases: [],
    unassignedCases: [
      { customerName: "Orphan Inc", totalOverdue: 750, nextActionAt: null },
    ],
    appUrl: "https://app.nudgepay.com",
    today: "2026-07-02",
  });
  expect(result.html).toContain("Unassigned accounts");
  expect(result.html).toContain("Orphan Inc");
});

test("digest email escapes HTML in names", () => {
  const result = digestEmail({
    recipientName: "<b>Evil</b>",
    assignedCases: [{ customerName: "X&Y", totalOverdue: 100, nextActionAt: null }],
    unassignedCases: [],
    appUrl: "https://x.com",
    today: "2026-07-02",
  });
  expect(result.html).not.toContain("<b>Evil</b>");
  expect(result.html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  expect(result.html).toContain("X&amp;Y");
});
