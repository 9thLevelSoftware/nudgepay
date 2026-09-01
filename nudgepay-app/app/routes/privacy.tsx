import { PublicLayout } from "../components/PublicLayout";
import { pageTitle, SUPPORT_EMAIL } from "../lib/meta";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => pageTitle("Privacy Policy");

const updated = "August 31, 2026";
const contact = SUPPORT_EMAIL;

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

      <h2 className="text-base font-semibold text-text mt-6 mb-2">4b. Messaging data (email)</h2>
      <p className="text-sm text-text leading-relaxed mb-3">When you email a customer, we process the destination address, subject,
        body, and delivery events through Resend. Inbound replies to a configured
        receiving mailbox are recorded in your workspace. We honor unsubscribe
        requests (CAN-SPAM / RFC 8058 one-click) and do not send collection email
        after a customer opts out.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">7. Sub-processors</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We rely on Intuit (QuickBooks Online), Twilio (SMS delivery), Resend
        (transactional email send and inbound receiving), Supabase
        (database and authentication), and Cloudflare (application hosting). Render
        may host a secondary Node runtime for staging.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">8. Data retention and deletion</h2>
      <p className="text-sm text-text leading-relaxed mb-3">Expired OAuth states, notification logs older than 90 days, resolved
        sync errors older than 90 days, and unused invites that have expired are
        purged automatically. Invoices, customers, cases, and messages stay until
        an owner deletes the workspace or erases a customer.
        Disconnecting QuickBooks revokes and deletes stored tokens. You can
        leave this workspace in Settings by typing your email or LEAVE. That
        removes your membership and signs you out. It does not delete the
        workspace or erase invoices, customers, or messages. If you are the last remaining
        member and QuickBooks is connected, we disconnect those tokens. The last owner
        cannot leave; they must transfer ownership or delete the workspace.
        Owners can download a JSON copy of workspace customers, invoices, cases,
        and messages in Settings. Owners delete a workspace in Settings by typing
        its name; that revokes
        QuickBooks tokens, purges tenant data, and writes a deletion tombstone.
        Owners can erase a customer&apos;s stored name, phone, email, notes, and
        message bodies from the account page by typing the customer name.
        Invoices remain; QuickBooks is not deleted; later sync will not restore
        the erased fields. You can download a JSON copy of your NudgePay login, membership, and
        contact-log activity in Settings (or onboarding if you have no workspace).
        You can delete your NudgePay login in Settings, or on onboarding if you
        have no workspace, by typing your email or DELETE. That removes the Auth
        user and your membership. Contact-log and message actor fields are
        cleared; remaining workspace invoices, customers, and messages stay
        unless an owner deleted the workspace. For other erasure requests,
        contact {contact}.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">9. Payments and automated sequences</h2>
      <p className="text-sm text-text leading-relaxed mb-3">NudgePay does not process payments and does not send automatic
        reminder sequences. Each text and email is sent by a person on your team.
        You may optionally store a URL to your own payment page for use in
        message templates. We do not charge your customers.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">10. No sale of data</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We do not sell your data or share it for advertising.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">11. Governing law</h2>
      <p className="text-sm text-text leading-relaxed mb-3">This policy is governed by the laws of Florida.</p>
    </PublicLayout>
  );
}
