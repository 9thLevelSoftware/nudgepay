// Pure mapper: Resend webhook event -> normalized DB intent. Isolates Resend's
// taxonomy from the data layer. No I/O.

export type ResendEvent = { type: string; data: Record<string, any> };

export type MappedStatus = {
  kind: "status";
  providerMessageId: string;
  status: string;       // "sent"|"delivered"|"bounced"|"delayed"|"complained"
  errorCode: string | null;
  optOut: boolean;
};
export type MappedInbound = {
  kind: "inbound";
  from: string; to: string; subject: string; body: string; providerMessageId: string;
};
export type MappedEvent = MappedStatus | MappedInbound | { kind: "ignore" };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function mapResendEvent(evt: ResendEvent): MappedEvent {
  const d = evt.data ?? {};
  switch (evt.type) {
    case "email.sent":
      return { kind: "status", providerMessageId: str(d.email_id), status: "sent", errorCode: null, optOut: false };
    case "email.delivered":
      return { kind: "status", providerMessageId: str(d.email_id), status: "delivered", errorCode: null, optOut: false };
    case "email.delivery_delayed":
      return { kind: "status", providerMessageId: str(d.email_id), status: "delayed", errorCode: null, optOut: false };
    case "email.bounced": {
      const bounceType = str(d.bounce?.type).toLowerCase();
      const permanent = bounceType === "permanent" || bounceType === "hard";
      return { kind: "status", providerMessageId: str(d.email_id), status: "bounced",
        errorCode: bounceType || "bounce", optOut: permanent };
    }
    case "email.complained":
      return { kind: "status", providerMessageId: str(d.email_id), status: "complained", errorCode: "complaint", optOut: true };
    case "inbound.email.received":
    case "email.inbound":
      return { kind: "inbound", from: str(d.from), to: str(d.to), subject: str(d.subject),
        body: str(d.text) || str(d.html), providerMessageId: str(d.email_id) };
    default:
      return { kind: "ignore" };
  }
}
