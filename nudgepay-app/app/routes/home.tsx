import { Link } from "react-router";
import { PublicLayout } from "../components/PublicLayout";

const primaryLinkClass =
  "rounded-md bg-copper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-copper/90 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";
const secondaryLinkClass =
  "rounded-md border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:border-copper " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export default function Home() {
  return (
    <PublicLayout width="prose">
      <div className="text-center">
        <h1 className="font-display text-3xl font-semibold text-text sm:text-4xl">
          Get paid faster, without the awkward follow-up.
        </h1>
        <p className="mt-4 text-base text-muted">
          NudgePay sends polite, automatic payment reminders for your QuickBooks invoices,
          so you spend less time chasing and more time working.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/signup" className={primaryLinkClass}>Sign up</Link>
          <Link to="/login" className={secondaryLinkClass}>Log in</Link>
        </div>
        <p className="mt-16 text-xs text-muted">
          <Link to="/privacy" className="underline hover:text-text">Privacy Policy</Link>
          {" · "}
          <Link to="/eula" className="underline hover:text-text">EULA</Link>
        </p>
      </div>
    </PublicLayout>
  );
}
