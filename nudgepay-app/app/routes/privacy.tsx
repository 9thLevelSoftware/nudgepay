import { PublicLayout } from "../components/PublicLayout";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => pageTitle("Privacy Policy");

const updated = "July 1, 2026";
const contact = "support@nudgepay-ar.app";

export default function Privacy() {
  return (
    <PublicLayout title="Privacy Policy" width="prose">
      <p className="text-sm text-text leading-relaxed mb-3">
        Effective date: {updated}. Operated by 9th Level Software ("we", "us").
      </p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">1. Who we are</h2>
      <p className="text-sm text-text leading-relaxed mb-3">NudgePay is an accounts-receivable collections tool that connects to your
        QuickBooks Online account to surface overdue invoices and help your team
        follow up. Questions: {contact}.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">2. Data we access from QuickBooks Online</h2>
      <p className="text-sm text-text leading-relaxed mb-3">With your authorization we read invoices, customers, balances, and due
        dates. We use this data solely to display overdue invoices and manage
        collections on your behalf. We do not access QuickBooks data beyond what
        these features require.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">3. QuickBooks authorization tokens</h2>
      <p className="text-sm text-text leading-relaxed mb-3">OAuth access and refresh tokens are encrypted at rest using AES-256 and
        are never exposed to your browser. When you disconnect QuickBooks, we
        revoke the tokens with Intuit and delete them from our systems.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">4. Messaging data (SMS)</h2>
      <p className="text-sm text-text leading-relaxed mb-3">When you text a customer, we process the destination phone number, the
        message body, and Twilio delivery status. We send SMS only to customers
        with recorded consent, honor STOP/HELP opt-out keywords, and operate in
        compliance with TCPA and A2P 10DLC requirements.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">5. Account data</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We store your user email and team membership to authenticate you and
        control access to your organization's data.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">6. Storage and security</h2>
      <p className="text-sm text-text leading-relaxed mb-3">All data is encrypted in transit and at rest. Row-level security isolates
        each organization's data so members of one organization cannot access
        another's.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">7. Sub-processors</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We rely on Intuit (QuickBooks Online), Twilio (SMS delivery), Supabase
        (database and authentication), and Cloudflare (application hosting).</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">8. Data retention and deletion</h2>
      <p className="text-sm text-text leading-relaxed mb-3">Disconnecting QuickBooks revokes and deletes stored tokens. To request
        deletion of your other stored data, contact {contact}.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">9. No sale of data</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We do not sell your data or share it for advertising.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">10. Governing law</h2>
      <p className="text-sm text-text leading-relaxed mb-3">This policy is governed by the laws of Florida.</p>
    </PublicLayout>
  );
}
