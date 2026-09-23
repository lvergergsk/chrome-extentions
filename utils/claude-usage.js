// Read-only subscription usage. Session cookies stay in Chrome.
const ORIGIN = "https://claude.ai";
const WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];
const REASONS = ["config_off", "tier", "seat", "mobile", "surface", "cli_version", "no_grant",
  "tenure", "other_experiment", "control", "not_enrolled", "plan_changed", "unavailable"];
const MAX_BYTES = 1024 * 1024;

function date(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error("Invalid date.");
  return new Date(value).toISOString();
}

function resetInventory(block) {
  if (!block || typeof block.eligible !== "boolean") return null;
  if (!block.eligible) return {
    eligible: false,
    ineligible_reason: REASONS.includes(block.ineligible_reason) ? block.ineligible_reason : "unavailable",
  };
  if (!Array.isArray(block.grants) || block.grants.length > 100) return null;
  const seen = new Set();
  const grants = [];
  for (const grant of block.grants) {
    if (!grant || typeof grant.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(grant.id)
        || !Number.isSafeInteger(grant.resets_left) || grant.resets_left < 0
        || (grant.paused !== undefined && typeof grant.paused !== "boolean")) return null;
    if (seen.has(grant.id)) return null;
    seen.add(grant.id);
    grants.push({ resets_left: grant.resets_left, starts_at: date(grant.starts_at),
      ends_at: date(grant.ends_at), paused: grant.paused ?? false });
  }
  return { eligible: true, grants };
}

export function sanitizeClaudeUsage(payload) {
  const result = {};
  for (const key of WINDOWS) {
    const window = payload?.[key];
    if (!window || typeof window.utilization !== "number" || !Number.isFinite(window.utilization)
        || window.utilization < 0 || window.utilization > 100) continue;
    result[key] = { utilization: window.utilization, resets_at: date(window.resets_at) };
  }
  if (!Object.keys(result).length) throw new Error("Claude web usage has no quota windows.");
  try { result.cedar_ember = resetInventory(payload?.cedar_ember); }
  catch { result.cedar_ember = null; }
  return result;
}

async function readJson(path, signal, fetchFn) {
  const response = await fetchFn(`${ORIGIN}${path}`, {
    method: "GET", credentials: "include", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json" }, signal,
  });
  if (!response.ok) throw new Error("Claude web usage unavailable.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Claude web response too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function readClaudeUsage(fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const bootstrap = await readJson(
      "/api/bootstrap?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false",
      controller.signal, fetchFn,
    );
    const memberships = bootstrap?.account?.memberships;
    if (!Array.isArray(memberships)) throw new Error("Missing Claude login.");
    const organizations = memberships.map((member) => member?.organization).filter((org) =>
      Array.isArray(org?.capabilities) && org.capabilities.includes("chat")
      && !org.capabilities.some((capability) => ["api", "raven"].includes(capability))
      && org.capabilities.some((capability) => ["claude_pro", "claude_max"].includes(capability)));
    // ponytail: one personal subscription only; ambiguous memberships need an explicit selector.
    if (organizations.length !== 1) throw new Error("Ambiguous Claude subscription.");
    const id = organizations[0].uuid;
    if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      throw new Error("Invalid Claude organization.");
    }
    return sanitizeClaudeUsage(await readJson(
      `/api/organizations/${id}/usage?cedar_ember=1&skip_spend=1`, controller.signal, fetchFn,
    ));
  } catch {
    // Never forward server bodies, account metadata, URLs or fetch errors over the bridge.
    throw new Error("Claude web usage unavailable; check the Chrome login and subscription.");
  } finally {
    clearTimeout(timer);
  }
}
