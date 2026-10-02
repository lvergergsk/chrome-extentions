// Slack Later for the fixed ChatOps session channel. The Slack web session stays in Chrome:
// the token lives only in this worker's memory and never crosses the bridge.
const WORKSPACE = "https://home-fa43516.slack.com";
export const CHANNEL = "C0C1RQAMF61";
export const TS = /^\d{10}\.\d{6}$/;
const TOKEN = /"api_token":"(xoxc-[0-9A-Za-z-]+)"/;
const AUTH_ERRORS = ["invalid_auth", "not_authed", "token_revoked", "token_expired"];
const MAX_PAGES = 20;

let token;

function failure(method, code) {
  // Only Slack's short error code crosses the bridge, never a body or the token.
  return new Error(`Slack Later ${method} failed: ${/^[a-z_]{1,40}$/.test(code) ? code : "unavailable"}`);
}

async function sessionToken(fetchFn, signal) {
  // The same page the desktop client opens embeds the web session's API token.
  const response = await fetchFn(`${WORKSPACE}/ssb/redirect`, {
    method: "GET", credentials: "include", cache: "no-store", signal,
  });
  const match = response.ok ? TOKEN.exec(await response.text()) : null;
  if (!match) throw failure("login", "not_authed");
  return match[1];
}

async function call(method, args, fetchFn, signal) {
  for (let attempt = 0; ; attempt += 1) {
    token ??= await sessionToken(fetchFn, signal);
    const response = await fetchFn(`${WORKSPACE}/api/${method}`, {
      method: "POST", credentials: "include", cache: "no-store", redirect: "error", signal,
      body: new URLSearchParams({ ...args, token }),
    });
    let data;
    try { data = await response.json(); } catch { throw failure(method, "unavailable"); }
    if (data?.ok === true) return data;
    if (attempt === 0 && AUTH_ERRORS.includes(data?.error)) {
      token = undefined;
      continue;
    }
    throw failure(method, data?.error);
  }
}

async function withDeadline(work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await work(controller.signal);
  } catch (error) {
    throw error.message?.startsWith("Slack Later ") ? error : failure("request", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

// In-progress Later messages of the session channel, as root timestamps only.
export function listLater(fetchFn = fetch) {
  return withDeadline(async (signal) => {
    const items = [];
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await call("saved.list", {
        filter: "saved", limit: "50", include_tombstones: "false", ...(cursor && { cursor }),
      }, fetchFn, signal);
      for (const item of Array.isArray(data.saved_items) ? data.saved_items : []) {
        if (item?.item_type === "message" && item.item_id === CHANNEL && TS.test(item.ts)) {
          items.push({ ts: item.ts });
        }
      }
      cursor = data.response_metadata?.next_cursor || "";
      if (!cursor) return items;
    }
    throw failure("saved.list", "too_many_pages");
  });
}

export function addLater(ts, fetchFn = fetch) {
  return withDeadline(async (signal) => {
    await call("saved.add", { item_type: "message", item_id: CHANNEL, ts }, fetchFn, signal);
    return { ts };
  });
}

export function markLater(ts, completed, fetchFn = fetch) {
  return withDeadline(async (signal) => {
    await call("saved.update", {
      item_type: "message", item_id: CHANNEL, ts, date_due: "0",
      mark: completed ? "completed" : "uncompleted",
    }, fetchFn, signal);
    return { ts, completed };
  });
}

export function resetSlackLaterToken() {
  token = undefined;
}
