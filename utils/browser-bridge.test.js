import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dispatchRequest, NATIVE_HOST, startBrowserBridge, validateRequest } from "./browser-bridge.js";
import { duplicateTabIds, organizeTabs, planTabMoves, queueTabWork } from "./tabs.js";

const request = (method, params = {}) => ({ id: "a".repeat(32), method, params });
const tab = (id, index, extra = {}) => ({
  id, index, windowId: 7, groupId: -1, url: `https://example.com/${id}`,
  title: String(id), pinned: false, active: false, ...extra,
});

test("dedupe retains pinned, then active, then leftmost exact URL across groups", () => {
  const tabs = [
    tab(1, 0, { pinned: true }), tab(2, 1, { url: "https://example.com/1", pinned: true }),
    tab(3, 2, { url: "https://example.com/1", active: true }),
    tab(4, 3, { url: "https://example.com/other", groupId: 9 }),
    tab(5, 4, { url: "https://example.com/other", active: true }),
    tab(6, 5, { url: "https://example.com/other?x=1" }),
    tab(7, 6, { url: "https://example.com/other#section" }),
    tab(8, 7, { url: "", pendingUrl: "https://example.com/other" }),
    tab(9, 8, { url: "" }), tab(10, 9, { url: "" }),
  ];
  assert.deepEqual(duplicateTabIds(tabs).sort((a, b) => a - b), [3, 4, 8]);
  assert.deepEqual(duplicateTabIds(tabs, true).sort((a, b) => a - b), [2, 3, 4, 8]);
});

function browser() {
  let tabs = [
    tab(1, 0, { pinned: true }),
    tab(7, 1),
    tab(5, 2, { groupId: 10 }), tab(4, 3, { groupId: 10 }),
    tab(3, 4, { groupId: 11 }), tab(2, 5, { groupId: 11 }),
    tab(8, 6, { url: "https://example.com/7" }), tab(6, 7),
  ];
  const calls = [];
  const renumber = () => tabs.forEach((entry, index) => { entry.index = index; });
  const api = {
    windows: {
      getLastFocused: async () => ({ id: 7, type: "normal" }),
      get: async (id) => ({ id, type: "normal" }),
    },
    tabs: {
      query: async ({ windowId }) => tabs.filter((entry) => windowId === undefined || entry.windowId === windowId).map((entry) => ({ ...entry })),
      remove: async (ids) => { calls.push(["remove", ids]); tabs = tabs.filter((entry) => !ids.includes(entry.id)); renumber(); },
      move: async (id, { index }) => {
        calls.push(["move", id, index]);
        const at = tabs.findIndex((entry) => entry.id === id);
        const [entry] = tabs.splice(at, 1);
        if (entry.groupId !== -1) {
          const bounds = tabs.filter((other) => other.groupId === entry.groupId).map((other) => tabs.indexOf(other));
          // Fail if sorting would pull a tab outside its group and dissolve it.
          if (bounds.length) assert.ok(index >= Math.min(...bounds) && index <= Math.max(...bounds) + 1);
        }
        tabs.splice(index, 0, entry);
        renumber();
      },
    },
    tabGroups: {
      query: async () => [{ id: 10, title: "Zebra" }, { id: 11, title: "Alpha" }],
      move: async (id, { index }) => {
        calls.push(["group", id, index]);
        const group = tabs.filter((entry) => entry.groupId === id);
        tabs = tabs.filter((entry) => entry.groupId !== id);
        tabs.splice(index, 0, ...group);
        renumber();
      },
    },
  };
  return { api, calls, ids: () => tabs.map((entry) => entry.id) };
}

test("organize previews without mutations, then sorts groups and tabs without touching pinned tabs", async () => {
  const { api, calls, ids } = browser();
  const preview = await organizeTabs({}, api);
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.duplicates.map((entry) => entry.id), [8]);
  assert.deepEqual(calls, []);
  const result = await organizeTabs({ apply: true }, api);
  assert.equal(result.sorted, 6);
  assert.deepEqual(ids(), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!calls.some(([kind, id]) => kind === "move" && id === 1));
});

test("organize accepts title, explicit window, pinned opt-in, and keeping duplicates", async () => {
  const { api, calls, ids } = browser();
  const result = await dispatchRequest(request("tabs.organize", {
    apply: true, sortBy: "title", windowId: 7, includePinned: true, dedupe: false,
  }), api);
  assert.equal(result.sorted, 8);
  assert.deepEqual(ids(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(calls.some(([kind, id]) => kind === "move" && id === 1));
  assert.ok(!calls.some(([kind]) => kind === "remove"));
});

test("invalid methods, options and unsafe open URLs fail before browser calls", async () => {
  for (const message of [
    request("page.eval"), { ...request("ping"), id: [] },
    { ...request("ping"), id: ["a".repeat(32)] }, request("ping", []),
    request("tabs.organize", { apply: "false" }), request("tabs.organize", { sortBy: "bad" }),
    request("tabs.list", { windowId: -1 }), request("tabs.list", { windowId: 1.1 }),
    request("tabs.open", { url: "javascript:alert(1)" }),
    request("tabs.open", { url: "file:///C:/secret" }),
    request("tabs.open", { url: "https://user:password@example.com/" }),
    request("tabs.open", { url: "https://example.com/", script: "alert(1)" }),
  ]) await assert.rejects(dispatchRequest(message, {}));
  assert.doesNotThrow(() => validateRequest(request("tabs.open", { url: "https://example.com/" })));
  const { api, calls } = browser();
  api.windows.getLastFocused = async () => ({ id: 7, type: "normal", incognito: true });
  await assert.rejects(organizeTabs({ apply: true }, api), /non-incognito/);
  assert.deepEqual(calls, []);
});

test("open uses the selected normal window and list excludes incognito tabs", async () => {
  const created = [];
  const api = {
    windows: {
      getLastFocused: async () => ({ id: 7, type: "normal" }),
      get: async (id) => ({ id, type: "normal", incognito: true }),
    },
    tabs: {
      create: async (params) => { created.push(params); return tab(1, 0, params); },
      query: async () => [tab(1, 0), tab(2, 1, { incognito: true })],
    },
  };
  await dispatchRequest(request("tabs.open", { url: "https://example.com/", active: false }), api);
  assert.deepEqual(created, [{ url: "https://example.com/", active: false, windowId: 7 }]);
  await assert.rejects(dispatchRequest(request("tabs.open", { url: "https://example.com/", windowId: 9 }), api), /non-incognito/);
  assert.equal(created.length, 1);
  assert.deepEqual((await dispatchRequest(request("tabs.list"), api)).map((entry) => entry.id), [1]);
});

test("shortcuts keep pinned/unpinned boundaries and selected order", () => {
  const selected = [tab(2, 1), tab(3, 2)];
  assert.deepEqual(planTabMoves(selected, "tab-left", 1, 5), [[2, 1], [3, 2]]);
  assert.deepEqual(planTabMoves(selected, "tab-right", 1, 5), [[3, 3], [2, 2]]);
  assert.deepEqual(planTabMoves(selected, "tab-front", 1, 5), [[2, 1], [3, 2]]);
  assert.deepEqual(planTabMoves(selected, "tab-back", 1, 5), [[3, 4], [2, 3]]);
});

test("native bridge reconnects after disconnect and never duplicates a live port", async () => {
  const event = () => ({ listeners: [], addListener(callback) { this.listeners.push(callback); } });
  const connections = [];
  const alarms = [];
  const api = {
    runtime: {
      getPlatformInfo: async () => ({ os: "win" }), getManifest: () => ({ version: "test" }),
      onStartup: event(), onInstalled: event(), onMessage: event(),
      connectNative(name) {
        assert.equal(name, NATIVE_HOST);
        const port = { onMessage: event(), onDisconnect: event(), sent: [], postMessage(message) { this.sent.push(message); } };
        connections.push(port);
        return port;
      },
    },
    commands: { onCommand: event(), getAll: async () => [
      { name: "tab-left", shortcut: "Alt+Shift+Left" },
      { name: "tab-right", shortcut: "" },
      { name: "_execute_action", shortcut: "" },
    ] },
    alarms: { onAlarm: event(), create: (name) => { alarms.push(name); } },
  };
  startBrowserBridge(api);
  await Promise.resolve();
  const reconnect = () => api.alarms.onAlarm.listeners[0]({ name: alarms[0] });
  reconnect();
  assert.equal(connections.length, 1);
  await connections[0].onMessage.listeners[0](request("ping"));
  assert.deepEqual(connections[0].sent, [{ id: "a".repeat(32), ok: true, result: {
    protocol: 1, version: "test", shortcuts: [
      { name: "tab-left", shortcut: "Alt+Shift+Left" },
      { name: "tab-right", shortcut: "" },
    ],
  } }]);
  connections[0].onDisconnect.listeners[0]();
  reconnect();
  assert.equal(connections.length, 2);
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
  for (const permission of ["nativeMessaging", "tabs", "tabGroups"]) assert.ok(manifest.permissions.includes(permission));
});

test("popup actions use the worker queue, preserve duplicates, and reject other senders", async () => {
  const event = () => ({ listeners: [], addListener(callback) { this.listeners.push(callback); } });
  const { api, calls, ids } = browser();
  const popup = "chrome-extension://utils/popup.html";
  api.runtime = {
    id: "utils", getURL: () => popup, onMessage: event(), onStartup: event(), onInstalled: event(),
    getPlatformInfo: async () => ({ os: "linux" }),
  };
  api.commands = { onCommand: event() };
  api.alarms = { onAlarm: event() };
  startBrowserBridge(api);
  const receive = api.runtime.onMessage.listeners[0];
  const sender = { id: "utils", url: popup };
  const message = { type: "utils.tabs.action", action: "sort-url", windowId: 7 };
  const send = (payload) => new Promise((resolve) => receive(payload, sender, resolve));
  for (const untrusted of [{ ...sender, tab: { id: 1 } }, { ...sender, id: "other" }, { ...sender, url: "https://example.com" }]) {
    assert.equal(receive(message, untrusted, () => assert.fail("must not respond")), undefined);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await send({ ...message, action: "close-all" }), { ok: false });
  assert.deepEqual(await send({ ...message, windowId: -1 }), { ok: false });
  for (const action of ["sort-url", "sort-title"]) {
    assert.deepEqual(await send({ ...message, action }), { ok: true });
    assert.equal(ids().length, 8);
    assert.ok(!calls.some(([kind]) => kind === "remove"));
  }
  const moves = [];
  api.tabs.query = async (query) => {
    assert.deepEqual(query, { currentWindow: true });
    return [tab(1, 0, { pinned: true }), tab(2, 1), tab(3, 2, { highlighted: true }), tab(4, 3)];
  };
  api.tabs.move = async (id, position) => moves.push([id, position.index]);
  for (const action of ["tab-left", "tab-right", "tab-front", "tab-back"]) {
    assert.deepEqual(await send({ ...message, action }), { ok: false });
    api.commands.onCommand.listeners[0](action);
    await queueTabWork(() => {});
  }
  assert.deepEqual(moves, [[3, 1], [3, 3], [3, 1], [3, 3]]);
  api.tabs.move = async () => { throw new Error("tab closed"); };
  api.commands.onCommand.listeners[0]("tab-left");
  await queueTabWork(() => {});
  api.tabs.move = async (id, position) => moves.push([id, position.index]);
  api.commands.onCommand.listeners[0]("tab-right");
  await queueTabWork(() => {});
  assert.deepEqual(moves.at(-1), [3, 3]);
  const html = readFileSync(new URL("./popup.html", import.meta.url), "utf8");
  assert.equal((html.match(/data-tab-action=/g) ?? []).length, 2);
  assert.doesNotMatch(html, /data-tab-action="tab-/);
});
