// Team/operator invite mail. Uses Resend + org from_address and ignores
// email_config.email_enabled (that switch is the customer collections channel).

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailConfig } from "./email-client.server";
import { fromAddressAllowed } from "./email-settings";

export type InviteEmailDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  email: EmailConfig | null;
};

export type InviteEmailResult = "sent" | "skipped" | "failed";

export async function trySendInviteEmail(
  deps: InviteEmailDeps,
  args: { orgId: string; orgName: string; to: string; acceptUrl: string },
): Promise<InviteEmailResult> {
  if (!deps.email) return "skipped";

  try {
    const { data: ecfg } = await deps.service
      .from("email_config")
      .select("from_address, from_name")
      .eq("org_id", args.orgId)
      .maybeSingle();
    const fromAddress = ((ecfg?.from_address as string) ?? "").trim();
    if (!fromAddress) return "skipped";
    if (!fromAddressAllowed(fromAddress, deps.email.allowedFrom, args.orgId)) return "failed";
    const fromName = ((ecfg?.from_name as string) ?? "").trim();
    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
    const orgName = args.orgName.trim() || "a workspace";

    await sendEmail(deps.fetchFn, deps.email, {
      from,
      to: args.to,
      subject: `You're invited to ${orgName} on NudgePay`,
      text:
        `You've been invited to join ${orgName} on NudgePay.\n\n` +
        `Accept the invite:\n${args.acceptUrl}\n\n` +
        `This link expires in 14 days.`,
    });
    return "sent";
  } catch (e) {
    console.error("invite email failed", e);
    return "failed";
  }
}
