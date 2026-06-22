export default function Privacy() {
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>NudgePay Privacy Policy</h1>
      <p>Last updated: 2026-06-22.</p>
      <p>NudgePay connects to your QuickBooks Online account to display overdue
        invoices and help your team manage collections. We store invoice,
        customer, contact-log, and message data on your behalf, encrypted in
        transit and at rest. QuickBooks OAuth tokens are encrypted at rest and
        are never exposed to the browser. We do not sell your data.</p>
      <p>To disconnect QuickBooks and delete stored tokens, use the Disconnect
        action in the app. Contact: support@nudgepay-ar.app.</p>
    </main>
  );
}
