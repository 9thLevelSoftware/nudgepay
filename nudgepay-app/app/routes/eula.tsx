import { PublicLayout } from "../components/PublicLayout";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/eula";

export const meta: Route.MetaFunction = () => pageTitle("EULA");

export default function Eula() {
  return (
    <PublicLayout title="End User License Agreement" width="prose">
      <p className="text-sm text-text leading-relaxed mb-3">
        Effective date: July 1, 2026. This agreement is between you and 9th Level Software.
      </p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">1. License</h2>
      <p className="text-sm text-text leading-relaxed mb-3">We grant you a limited, non-exclusive, non-transferable license to use
        NudgePay to manage your own business's accounts-receivable collections.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">2. Acceptable use</h2>
      <p className="text-sm text-text leading-relaxed mb-3">You will use NudgePay only for your own business and in compliance with
        applicable law. You are solely responsible for obtaining and maintaining
        valid consent (TCPA / A2P 10DLC) before sending SMS to your customers,
        and for honoring opt-out requests.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">3. Disclaimer</h2>
      <p className="text-sm text-text leading-relaxed mb-3">NudgePay is provided "as is" during private beta, without warranties of
        any kind, express or implied.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">4. Limitation of liability</h2>
      <p className="text-sm text-text leading-relaxed mb-3">To the maximum extent permitted by law, 9th Level Software is not liable
        for indirect, incidental, or consequential damages arising from your use
        of NudgePay.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">5. Termination</h2>
      <p className="text-sm text-text leading-relaxed mb-3">Either party may terminate access at any time. On termination, your
        QuickBooks tokens are revoked with Intuit and removed from our systems.</p>

      <h2 className="text-base font-semibold text-text mt-6 mb-2">6. Governing law</h2>
      <p className="text-sm text-text leading-relaxed mb-3">This agreement is governed by the laws of Florida.</p>
    </PublicLayout>
  );
}
