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

export function getQboEnv(context: { cloudflare: { env: Record<string, string> } }): QboEnv {
  const e = context.cloudflare.env;
  const required = [
    "QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI",
    "QBO_ENCRYPTION_KEY", "QBO_WEBHOOK_VERIFIER_TOKEN",
  ];
  for (const k of required) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    QBO_CLIENT_ID: e.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: e.QBO_CLIENT_SECRET,
    QBO_REDIRECT_URI: e.QBO_REDIRECT_URI,
    QBO_ENCRYPTION_KEY: e.QBO_ENCRYPTION_KEY,
    QBO_WEBHOOK_VERIFIER_TOKEN: e.QBO_WEBHOOK_VERIFIER_TOKEN,
    QBO_SANDBOX: e.QBO_SANDBOX !== "false", // default true
  };
}

export type EmailEnv = {
  RESEND_API_KEY: string;
  APP_PUBLIC_BASE_URL: string | null; // public origin for unsubscribe links
  UNSUBSCRIBE_SECRET: string;
};

export function getEmailEnv(context: { cloudflare: { env: Record<string, string> } }): EmailEnv {
  const e = context.cloudflare.env;
  for (const k of ["RESEND_API_KEY", "UNSUBSCRIBE_SECRET"]) {
    if (!e[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    RESEND_API_KEY: e.RESEND_API_KEY,
    APP_PUBLIC_BASE_URL: e.APP_PUBLIC_BASE_URL || null,
    UNSUBSCRIBE_SECRET: e.UNSUBSCRIBE_SECRET,
  };
}

export type TwilioEnv = {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_MESSAGING_SERVICE_SID: string | null; // production-preferred sender
  TWILIO_FROM_NUMBER: string | null;            // trial/fallback sender (E.164)
  TWILIO_PUBLIC_BASE_URL: string | null;        // public origin for webhook signature + StatusCallback
};

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
