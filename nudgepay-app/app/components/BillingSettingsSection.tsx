import { Form } from "react-router";
import { Button } from "./ui";
import {
  BILLING_COPY,
  billingIsCurrent,
  billingStatusLabel,
  type BillingStatus,
} from "../lib/billing";

export function BillingSettingsSection(d: {
  isOwner: boolean;
  configured: boolean;
  status: BillingStatus;
  currentPeriodEnd: string | null;
  returnTo: string;
  flash: string | null;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">{BILLING_COPY.heading}</h2>
      <p className="mt-0.5 text-xs text-muted">{BILLING_COPY.body}</p>
      {!d.configured ? (
        <p className="mt-3 text-sm text-muted">{BILLING_COPY.unconfigured}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-text">
            Status: <span className="font-medium">{billingStatusLabel(d.status)}</span>
            {d.currentPeriodEnd ? (
              <span className="text-muted">
                {" "}· current period ends {d.currentPeriodEnd.slice(0, 10)}
              </span>
            ) : null}
          </p>
          {d.isOwner ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {billingIsCurrent(d.status) ? (
                <Form method="post" action="/api/billing/portal">
                  <input type="hidden" name="returnTo" value={d.returnTo} />
                  <Button type="submit" variant="secondary" size="sm">
                    Manage subscription
                  </Button>
                </Form>
              ) : (
                <Form method="post" action="/api/billing/checkout">
                  <input type="hidden" name="returnTo" value={d.returnTo} />
                  <Button type="submit" size="sm">
                    Subscribe
                  </Button>
                </Form>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{BILLING_COPY.members}</p>
          )}
        </>
      )}
      {d.flash === "success" ? (
        <p className="mt-2 text-xs text-cool" role="status">Subscription updated.</p>
      ) : null}
      {d.flash === "cancel" ? (
        <p className="mt-2 text-xs text-muted" role="status">Checkout canceled.</p>
      ) : null}
      {d.flash === "forbidden" ? (
        <p className="mt-2 text-xs text-hot" role="alert">Only owners can manage billing.</p>
      ) : null}
      {d.flash === "unconfigured" || d.flash === "error" ? (
        <p className="mt-2 text-xs text-hot" role="alert">Could not start billing. Try again.</p>
      ) : null}
    </section>
  );
}
