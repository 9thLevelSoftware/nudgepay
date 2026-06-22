import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers } = createSupabaseUserClient(request, env);
  await supabase.auth.signOut();
  return redirect("/login", { headers });
}

export function loader() {
  return redirect("/login");
}
