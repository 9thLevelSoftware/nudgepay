// Liveness probe for Render's healthCheckPath (render.yaml). Resource route:
// loader only, no default export, so app/root.tsx renders nothing for it.
//
// Deliberately shallow — no Supabase round-trip. Render rolls a deploy back when
// the health check fails, so a transient upstream blip must not take the service down.
export function loader() {
  return Response.json({ ok: true });
}
