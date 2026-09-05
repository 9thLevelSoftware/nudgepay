function inventoryError(message) {
  return new Error(`Supabase migration inventory failed: ${message}`);
}

export function projectRefFromSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw inventoryError("sealed target is not a hosted Supabase URL");
  }
  const projectRef = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname)?.[1]?.toLowerCase();
  if (!projectRef || url.protocol !== "https:" || url.username || url.password || url.port) {
    throw inventoryError("sealed target is not a hosted Supabase URL");
  }
  return projectRef;
}

export function parseSupabaseMigrationInventory(body) {
  if (
    !Array.isArray(body)
    || body.length === 0
    || body.some((entry) => (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !/^\d+$/.test(entry.version ?? "")
      || typeof entry.name !== "string"
      || entry.name.length === 0
    ))
  ) throw inventoryError("Management API response has an invalid schema");
  return body.map((entry) => ({ local: entry.version, remote: entry.version }));
}

export async function fetchSupabaseMigrationInventory({
  projectRef,
  accessToken,
  fetchFn = fetch,
}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? "")) throw inventoryError("project ref is invalid");
  if (typeof accessToken !== "string" || accessToken.length < 20 || accessToken.length > 512) {
    throw inventoryError("SUPABASE_ACCESS_TOKEN is required");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response;
    try {
      response = await fetchFn(
        `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        },
      );
    } catch {
      throw inventoryError("Management API request failed");
    }
    if (!response.ok) throw inventoryError(`Management API returned HTTP ${response.status}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw inventoryError("Management API returned invalid JSON");
    }
    return parseSupabaseMigrationInventory(body);
  } finally {
    clearTimeout(timeout);
  }
}
