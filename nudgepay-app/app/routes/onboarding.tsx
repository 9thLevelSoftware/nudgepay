import { useState } from "react";
import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createOrgForUser } from "../lib/orgs.server";
import { isAlreadyInWorkspaceError } from "../lib/org-membership";
import { PERSONAL_DELETE_TOKEN, personalAccountConfirmMatches } from "../lib/personal-account-deletion";
import { PublicLayout } from "../components/PublicLayout";
import { Button, Input, inputClass } from "../components/ui";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/onboarding";

export const meta: Route.MetaFunction = () => pageTitle("Onboarding");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (org) throw redirect("/dashboard", { headers });
  return data({ email: user.email ?? "" }, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const existing = await resolveOrg(supabase, user.id);
  if (existing) return redirect("/dashboard", { headers });
  const form = await request.formData();
  const raw = form.get("orgName");
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { error: "Organization name is required" };
  const service = createSupabaseServiceClient(env);
  try {
    await createOrgForUser(service, user.id, name);
  } catch (e) {
    if (isAlreadyInWorkspaceError(e)) return redirect("/dashboard", { headers });
    throw e;
  }
  return redirect("/dashboard", { headers });
}

export default function Onboarding() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [sp] = useSearchParams();
  const creating = navigation.state !== "idle" && navigation.formAction !== "/api/account/delete";
  const deleting = navigation.state !== "idle" && navigation.formAction === "/api/account/delete";
  const accountError = sp.get("accountError");
  const [typed, setTyped] = useState("");
  const canDelete = personalAccountConfirmMatches(typed, d.email);

  return (
    <PublicLayout title="Name your organization" width="card">
      <Form method="post" className="grid gap-4">
        {actionData?.error && <p role="alert" className="text-sm text-hot">{actionData.error}</p>}
        <label className="grid gap-1 text-sm font-medium text-text">
          Organization name
          <input name="orgName" placeholder="e.g. Chancey Heating & Cooling" required className={inputClass} />
        </label>
        <Button type="submit" disabled={creating}>{creating ? "Creating organization…" : "Create organization"}</Button>
      </Form>
      <section className="mt-8 rounded-lg border border-hot/40 bg-surface p-5">
        <h2 className="font-display text-base font-semibold text-text">Delete my NudgePay account</h2>
        <p className="mt-0.5 text-xs text-muted">
          You have no workspace. Deleting your login removes the Auth user.
          Type your email or{" "}
          <span className="font-medium text-text">{PERSONAL_DELETE_TOKEN}</span> to confirm.
        </p>
        <Form method="post" action="/api/account/delete" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="returnTo" value="/onboarding" />
          <label className="grid gap-1 text-sm font-medium text-text">
            Confirm
            <Input
              name="confirm"
              type="text"
              required
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={!canDelete || deleting}
            className="w-fit"
          >
            {deleting ? "Deleting…" : "Delete my NudgePay account"}
          </Button>
        </Form>
        {accountError === "confirm" ? (
          <p className="mt-2 text-xs text-hot" role="alert">Type your email or DELETE to confirm.</p>
        ) : null}
        {accountError === "account" ? (
          <p className="mt-2 text-xs text-hot" role="alert">Could not delete your NudgePay login. Try again.</p>
        ) : null}
      </section>
    </PublicLayout>
  );
}
