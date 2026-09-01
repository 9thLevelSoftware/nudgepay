export type AppEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
};

// RR7 Cloudflare adapter exposes vars on context.cloudflare.env
export function getEnv(context: { cloudflare: { env: Record<string, string> } }): AppEnv {
  const e = context.cloudflare.env;
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: e.SUPABASE_SERVICE_KEY,
  };
}

export type QboEnv = {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_REDIRECT_URI: string;
  QBO_ENCRYPTION_KEY: string; // base64 of 32 random bytes (AES-256)
  QBO_WEBHOOK_VERIFIER_TOKEN: string; // Intuit webhook verifier token
  QBO_SANDBOX: boolean;
};

export function getQboEnvOrNull(
  context: { cloudflare: { env: Record<string, string> } },
): QboEnv | null {
  const e = context.cloudflare.env;
  const required = [
    "QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI",
    "QBO_ENCRYPTION_KEY", "QBO_WEBHOOK_VERIFIER_TOKEN",
  ];
  if (required.some((k) => !e[k])) return null;
  return {
    QBO_CLIENT_ID: e.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: e.QBO_CLIENT_SECRET,
    QBO_REDIRECT_URI: e.QBO_REDIRECT_URI,
    QBO_ENCRYPTION_KEY: e.QBO_ENCRYPTION_KEY,
    QBO_WEBHOOK_VERIFIER_TOKEN: e.QBO_WEBHOOK_VERIFIER_TOKEN,
    QBO_SANDBOX: e.QBO_SANDBOX !== "false",
  };
}

export function getQboEnv(context: { cloudflare: { env: Record<string, string> } }): QboEnv {
  const qbo = getQboEnvOrNull(context);
  if (!qbo) throw new Error("Missing required QBO env vars");
  return qbo;
}

export type EmailEnv = {
  RESEND_API_KEY: string;
  APP_PUBLIC_BASE_URL: string | null; // public origin for unsubscribe links
  UNSUBSCRIBE_SECRET: string;
  RESEND_WEBHOOK_SECRET: string;
  RESEND_ALLOWED_FROM: string | null;
};

export function resendTransport(e: EmailEnv): { apiKey: string; allowedFrom: string | null } {
  return { apiKey: e.RESEND_API_KEY, allowedFrom: e.RESEND_ALLOWED_FROM };
}

export function getEmailEnv(context: { cloudflare: { env: Record<string, string> } }): EmailEnv {
  const e = context.cloudflare.env;
  for (const k of ["RESEND_API_KEY", "UNSUBSCRIBE_SECRET", "RESEND_WEBHOOK_SECRET"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    RESEND_API_KEY: e.RESEND_API_KEY,
    APP_PUBLIC_BASE_URL: e.APP_PUBLIC_BASE_URL || null,
    UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET,
    RESEND_WEBHOOK_SECRET: e.RESEND_WEBHOOK_SECRET,
    RESEND_ALLOWED_FROM: e.RESEND_ALLOWED_FROM || null,
  };
}

/**
 * Like getEmailEnv, but returns null when the Resend key is absent instead of
 * throwing. Used by notification/alert paths that must never 500 the sync or
 * cron even when email secrets are not yet configured.
 */
export function getEmailEnvOrNull(
  context: { cloudflare: { env: Record<string, string> } },
): EmailEnv | null {
  const e = context.cloudflare.env;
  if (!e.RESEND_API_KEY || !e.UNSUBSCRIBE_SECRET || !e.RESEND_WEBHOOK_SECRET) return null;
  return {
    RESEND_API_KEY: e.RESEND_API_KEY,
    APP_PUBLIC_BASE_URL: e.APP_PUBLIC_BASE_URL || null,
    UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET,
    RESEND_WEBHOOK_SECRET: e.RESEND_WEBHOOK_SECRET,
    RESEND_ALLOWED_FROM: e.RESEND_ALLOWED_FROM || null,
  };
}

// The public CAN-SPAM unsubscribe page only verifies the HMAC token — it never
// sends mail. Scope its env to UNSUBSCRIBE_SECRET alone so the legally-required
// opt-out keeps working even if the Resend send key is absent or rotated out
// (getEmailEnv would otherwise 500 the page on a missing RESEND_API_KEY).
export function getUnsubscribeEnv(context: { cloudflare: { env: Record<string, string> } }): { UNSUBSCRIBE_SECRET: string } {
  const e = context.cloudflare.env;
  if (!e.UNSUBSCRIBE_SECRET) throw new Error("Missing required env var: UNSUBSCRIBE_SECRET");
  return { UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET };
}

export type TwilioEnv = {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_MESSAGING_SERVICE_SID: string | null; // production-preferred sender
  TWILIO_FROM_NUMBER: string | null;            // trial/fallback sender (E.164)
  TWILIO_PUBLIC_BASE_URL: string | null;        // public origin for webhook signature + StatusCallback
};

/**
 * Like getTwilioEnv, but returns null when Twilio creds are absent instead of
 * throwing. Used by the settings status panel and test-send route so they
 * never 500 when env secrets are not yet configured.
 */
export function getTwilioEnvOrNull(
  context: { cloudflare: { env: Record<string, string> } },
): TwilioEnv | null {
  const e = context.cloudflare.env;
  if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN) return null;
  const messagingServiceSid = e.TWILIO_MESSAGING_SERVICE_SID || null;
  const fromNumber = e.TWILIO_FROM_NUMBER || null;
  if (!messagingServiceSid && !fromNumber) return null;
  return {
    TWILIO_ACCOUNT_SID: e.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: e.TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
    TWILIO_FROM_NUMBER: fromNumber,
    TWILIO_PUBLIC_BASE_URL: e.TWILIO_PUBLIC_BASE_URL || null,
  };
}

/**
 * Non-throwing reader of public base URLs (for webhook URL display + StatusCallback).
 * Returned even when send credentials are absent — that's exactly when the
 * operator is setting up and needs to see the webhook URLs to paste into consoles.
 */
export function getPublicBaseUrls(
  context: { cloudflare: { env: Record<string, string> } },
): { twilioBaseUrl: string | null; appBaseUrl: string | null } {
  const e = context.cloudflare.env;
  return {
    twilioBaseUrl: e.TWILIO_PUBLIC_BASE_URL || null,
    appBaseUrl: e.APP_PUBLIC_BASE_URL || null,
  };
}

export function getTwilioEnv(context: { cloudflare: { env: Record<string, string> } }): TwilioEnv {
  const e = context.cloudflare.env;
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  const messagingServiceSid = e.TWILIO_MESSAGING_SERVICE_SID || null;
  const fromNumber = e.TWILIO_FROM_NUMBER || null;
  if (!messagingServiceSid && !fromNumber) {
    throw new Error("Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }
  return {
    TWILIO_ACCOUNT_SID: e.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: e.TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
    TWILIO_FROM_NUMBER: fromNumber,
    TWILIO_PUBLIC_BASE_URL: e.TWILIO_PUBLIC_BASE_URL || null,
  };
}

// Unset or any value other than the exact string "true" keeps env-default fallback.
export function smsRequireInventory(env: Record<string, string | undefined>): boolean {
  return env.SMS_REQUIRE_INVENTORY === "true";
}

export type StripeEnv = {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
};

/** Agency SaaS billing. Null when secrets are not set — Settings degrades, no 500. */
export function getStripeEnvOrNull(
  context: { cloudflare: { env: Record<string, string> } },
): StripeEnv | null {
  const e = context.cloudflare.env;
  if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET || !e.STRIPE_PRICE_ID) return null;
  return {
    STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: e.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID: e.STRIPE_PRICE_ID,
  };
}
