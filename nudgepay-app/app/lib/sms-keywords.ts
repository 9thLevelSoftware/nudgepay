// Pure keyword + STOP-language helpers for SMS. No I/O.

export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"] as const;
export const START_KEYWORDS = ["START", "YES", "UNSTOP"] as const;
export const HELP_KEYWORDS = ["HELP", "INFO"] as const;

export const STOP_LANGUAGE = "Reply STOP to opt out";

export type InboundKeyword = "stop" | "start" | "help" | null;

function tokens(body: string): string[] {
  return body.trim().toUpperCase().split(/\s+/).filter(Boolean);
}

export function classifyInboundSms(body: string): InboundKeyword {
  const exact = body.trim().toUpperCase();
  if ((STOP_KEYWORDS as readonly string[]).includes(exact)) return "stop";
  if ((START_KEYWORDS as readonly string[]).includes(exact)) return "start";
  if ((HELP_KEYWORDS as readonly string[]).includes(exact)) return "help";
  const first = tokens(body)[0];
  if (!first) return null;
  if ((STOP_KEYWORDS as readonly string[]).includes(first)) return "stop";
  if ((START_KEYWORDS as readonly string[]).includes(first)) return "start";
  if ((HELP_KEYWORDS as readonly string[]).includes(first)) return "help";
  return null;
}

export function hasStopLanguage(body: string): boolean {
  return /reply\s+stop\s+to\s+opt\s+out/i.test(body);
}

export function ensureStopLanguage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return STOP_LANGUAGE;
  if (hasStopLanguage(trimmed)) return trimmed;
  return `${trimmed} ${STOP_LANGUAGE}`;
}

export function twimlMessage(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<Response><Message>${escaped}</Message></Response>`;
}

export function twimlForKeyword(keyword: InboundKeyword, orgName: string): string | null {
  if (keyword === "stop") {
    return twimlMessage("You have been unsubscribed and will no longer receive texts from us. Reply START to resume.");
  }
  if (keyword === "start") {
    return twimlMessage("You are resubscribed to text messages. Reply STOP to opt out.");
  }
  if (keyword === "help") {
    const name = orgName.trim() || "this sender";
    return twimlMessage(`${name}: Reply STOP to opt out. Msg rates may apply.`);
  }
  return null;
}
