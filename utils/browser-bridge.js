import { moveHighlightedTabs, organizeTabs, queueTabWork, tabResult } from "./tabs.js";
import { readClaudeUsage } from "./claude-usage.js";

export const NATIVE_HOST = "com.lvergergsk.gg_browser";
const RECONNECT_ALARM = "gg-browser-reconnect";
const MAX_MESSAGE = 1024 * 1024;
const METHODS = {
  ping: [],
  "claude.usage": [],
  "tabs.list": ["windowId"],
  "tabs.open": ["url", "active", "windowId"],
  "tabs.organize": ["windowId", "sortBy", "includePinned", "dedupe", "apply"],
};

export function validateRequest(request) {
  if (!request || typeof request.id !== "string" || !/^[a-f0-9]{32}$/.test(request.id)
      || typeof request.method !== "string" || !Object.hasOwn(METHODS, request.method)) {
    throw new Error("Invalid browser request.");
  }
  const params = request.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)
      || Object.keys(params).some((key) => !METHODS[request.method].includes(key))) {
    throw new Error("Invalid browser parameters.");
  }
  if (params.windowId !== undefined && (!Number.isSafeInteger(params.windowId) || params.windowId < 0)) {
    throw new Error("Invalid window ID.");
  }
  for (const key of ["active", "includePinned", "dedupe", "apply"]) {
    if (params[key] !== undefined && typeof params[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  }
  if (params.sortBy !== undefined && !["url", "title"].includes(params.sortBy)) {
    throw new Error("Sort by url or title.");
  }
  if (request.method === "tabs.open") {
    const url = new URL(params.url);
    if (typeof params.url !== "string" || !["https:", "http:"].includes(url.protocol)
        || url.username || url.password) throw new Error("Open requires an HTTP(S) URL without credentials.");
  }
  return params;
}

export async function dispatchRequest(request, api = chrome) {
  const params = validateRequest(request);
  switch (request.method) {
    case "ping":
      return { protocol: 1, version: api.runtime.getManifest().version };
    case "claude.usage":
      return readClaudeUsage();
    case "tabs.list":
      return (await api.tabs.query(params)).filter((tab) => !tab.incognito).map(tabResult);
    case "tabs.open": {
      const window = params.windowId === undefined
        ? await api.windows.getLastFocused({ windowTypes: ["normal"] })
        : await api.windows.get(params.windowId);
      if (window.type !== "normal" || window.incognito) {
        throw new Error("Choose a normal, non-incognito Chrome window.");
      }
      return tabResult(await api.tabs.create({ ...params, windowId: window.id }));
    }
    case "tabs.organize":
      return queueTabWork(() => organizeTabs(params, api));
  }
}

export function startBrowserBridge(api = chrome) {
  let port;
  let nativeEnabled = false;
  const connect = () => {
    if (port || !nativeEnabled) return;
    try {
      const connection = api.runtime.connectNative(NATIVE_HOST);
      port = connection;
      connection.onMessage.addListener(async (request) => {
        if (request?.event === "ready") return;
        let response;
        try {
          response = { id: request?.id, ok: true, result: await dispatchRequest(request, api) };
          if (new TextEncoder().encode(JSON.stringify(response)).length > MAX_MESSAGE) {
            throw new Error("Response too large; select one window.");
          }
        } catch (error) {
          response = { id: request?.id, ok: false, error: error.message || "Browser request failed." };
        }
        // A disconnected host must not produce an unhandled worker rejection.
        try { connection.postMessage(response); } catch { /* Reconnect on the next alarm. */ }
      });
      connection.onDisconnect.addListener(() => {
        void api.runtime.lastError;
        if (port === connection) port = undefined;
      });
    } catch {
      port = undefined;
    }
  };
  api.commands.onCommand.addListener((command) => {
    if (!command.startsWith("tab-")) return;
    queueTabWork(() => moveHighlightedTabs(command, api)).catch(() => console.warn("Tab move failed."));
  });
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "utils.tabs.action") return;
    if (sender.id !== api.runtime.id || sender.tab || sender.url !== api.runtime.getURL("popup.html")) return;
    const { action, windowId } = message;
    if (!["sort-url", "sort-title", "tab-left", "tab-right", "tab-front", "tab-back"].includes(action)
        || !Number.isSafeInteger(windowId) || windowId < 0) {
      sendResponse({ ok: false });
      return;
    }
    queueTabWork(() => action.startsWith("sort-")
      ? organizeTabs({ windowId, sortBy: action.slice(5), apply: true, dedupe: false }, api)
      : moveHighlightedTabs(action, api, windowId))
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  });
  api.runtime.onStartup.addListener(connect);
  api.runtime.onInstalled.addListener(connect);
  api.alarms.onAlarm.addListener((alarm) => { if (alarm.name === RECONNECT_ALARM) connect(); });
  // TODO: On Windows verify host installation, restart/reconnect, and port teardown in Chrome.
  api.runtime.getPlatformInfo().then(({ os }) => {
    if (os !== "win") return;
    nativeEnabled = true;
    api.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
    connect();
  });
}
