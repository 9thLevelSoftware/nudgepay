const updated = "[Effective Date]";
const contact = "[Contact Email] (default: support@nudgepay-ar.app)";

export default function Privacy() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", fontFamily: "sans-serif", lineHeight: 1.5 }}>
      <h1>NudgePay Privacy Policy</h1>
      <p>Effective date: {updated}. Operated by [Legal Entity Name] ("we", "us").</p>

      <h2>1. Who we are</h2>
      <p>NudgePay is an accounts-receivable collections tool that connects to your
        QuickBooks Online account to surface overdue invoices and help your team
        follow up. Questions: {contact}.</p>

      <h2>2. Data we access from QuickBooks Online</h2>
      <p>With your authorization we read invoices, customers, balances, and due
        dates. We use this data solely to display overdue invoices and manage
        collections on your behalf. We do not access QuickBooks data beyond what
        these features require.</p>

      <h2>3. QuickBooks authorization tokens</h2>
      <p>OAuth access and refresh tokens are encrypted at rest using AES-256 and
        are never exposed to your browser. When you disconnect QuickBooks, we
        revoke the tokens with Intuit and delete them from our systems.</p>

      <h2>4. Messaging data (SMS)</h2>
      <p>When you text a customer, we process the destination phone number, the
        message body, and Twilio delivery status. We send SMS only to customers
        with recorded consent, honor STOP/HELP opt-out keywords, and operate in
        compliance with TCPA and A2P 10DLC requirements.</p>

      <h2>5. Account data</h2>
      <p>We store your user email and team membership to authenticate you and
        control access to your organization's data.</p>

      <h2>6. Storage and security</h2>
      <p>All data is encrypted in transit and at rest. Row-level security isolates
        each organization's data so members of one organization cannot access
        another's.</p>

      <h2>7. Sub-processors</h2>
      <p>We rely on Intuit (QuickBooks Online), Twilio (SMS delivery), Supabase
        (database and authentication), and Cloudflare (application hosting).</p>

      <h2>8. Data retention and deletion</h2>
      <p>Disconnecting QuickBooks revokes and deletes stored tokens. To request
        deletion of your other stored data, contact {contact}.</p>

      <h2>9. No sale of data</h2>
      <p>We do not sell your data or share it for advertising.</p>

      <h2>10. Governing law</h2>
      <p>This policy is governed by the laws of [Governing-Law State].</p>
    </main>
  );
}
