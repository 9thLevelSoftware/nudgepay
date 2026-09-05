export class ProviderSendRejectedError extends Error {
  readonly name = "ProviderSendRejectedError";

  constructor(
    readonly provider: "Twilio" | "Resend" | "Stripe",
    readonly status: number,
    detail = "",
  ) {
    super(`${provider} send failed${provider === "Twilio" ? `: ${status}` : ` (${status})`}${detail ? `: ${detail}` : ""}`);
  }
}

export class AmbiguousSendError extends Error {
  readonly name = "AmbiguousSendError";

  constructor() {
    super("Send status is unknown; do not retry until the provider result is reconciled");
  }
}

export class ProviderResponseAmbiguousError extends Error {
  readonly name = "ProviderResponseAmbiguousError";

  constructor(
    readonly provider: "Twilio" | "Resend" | "Stripe",
    readonly status: number,
    detail = "",
  ) {
    super(`${provider} response was ambiguous (${status})${detail ? `: ${detail}` : ""}`);
  }
}
