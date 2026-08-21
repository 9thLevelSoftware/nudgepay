import { redirect, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { safeReturnTo } from "../lib/return-to";
import { PublicLayout } from "../components/PublicLayout";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/auth.confirm";

export const meta: Route.MetaFunction = () => pageTitle("Confirm");

const CONFIRM_TYPES = ["signup", "email", "recovery", "invite", "magiclink"] as const;
type ConfirmType = (typeof CONFIRM_TYPES)[number];

function isConfirmType(v: string): v is ConfirmType {
  return (CONFIRM_TYPES as readonly string[]).includes(v);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const typeRaw = url.searchParams.get("type") ?? "";
  const next = safeReturnTo(url.searchParams.get("next"), "/dashboard");
  if (!tokenHash || !isConfirmType(typeRaw)) {
    return { error: true as const };
  }
  const env = getEnv(context as any);
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { error } = await supabase.auth.verifyOtp({ type: typeRaw, token_hash: tokenHash });
  if (error) return { error: true as const };
  if (typeRaw === "recovery") return redirect("/reset-password", { headers });
  return redirect(next, { headers });
}

export default function AuthConfirm({ loaderData }: Route.ComponentProps) {
  if (!loaderData || typeof loaderData !== "object" || !("error" in loaderData) || !loaderData.error) {
    return null;
  }
  return (
    <PublicLayout title="Link expired" width="card">
      <p className="text-sm text-muted">This confirmation link is invalid or has expired. Request a new one from the log-in page.</p>
    </PublicLayout>
  );
}
