import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALARM_SCHEDULES,
  CHECKIN_STORAGE_KEY,
  GAMES,
  checkInAll,
  checkInGame,
  ensureCheckinAlarms,
  nextLocalAlarm,
  readCheckinState,
  setCheckinEnabled,
  summarizeCheckinResults,
} from "./hoyolab-checkin.js";
import { buildCheckinView, formatCheckinTime } from "./hoyolab-popup.js";

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test("nextLocalAlarm returns today's future time and rolls past times to tomorrow", () => {
  const before = new Date(2026, 7, 24, 8, 0);
  assert.equal(nextLocalAlarm(9, 10, before), new Date(2026, 7, 24, 9, 10).getTime());

  const after = new Date(2026, 7, 24, 9, 11);
  assert.equal(nextLocalAlarm(9, 10, after), new Date(2026, 7, 25, 9, 10).getTime());
});

test("ensureCheckinAlarms creates only missing persistent daily alarms", async () => {
  const existing = new Map([[ALARM_SCHEDULES[0].name, { name: ALARM_SCHEDULES[0].name }]]);
  const created = [];
  const alarms = {
    get: async (name) => existing.get(name),
    create: async (name, info) => created.push({ name, info }),
  };
  const now = new Date(2026, 7, 24, 10, 0);

  await ensureCheckinAlarms(alarms, now);

  assert.deepEqual(created, [
    {
      name: "utils-hoyolab-afternoon",
      info: {
        when: new Date(2026, 7, 24, 15, 10).getTime(),
        periodInMinutes: 24 * 60,
        persistAcrossSessions: true,
      },
    },
  ]);
});

test("checkInGame trusts the server is_sign flag and skips an unnecessary sign request", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ retcode: 0, data: { is_sign: true } });
  };

  const result = await checkInGame(GAMES[0], fetchFn);

  assert.deepEqual(result, { game: "Genshin Impact", status: "already-signed" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers["x-rpc-signgame"], "hk4e");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/event/sol/info");
  assert.equal(url.searchParams.get("act_id"), "e202102251931481");
});

test("checkInGame signs and verifies the authoritative server state", async () => {
  const calls = [];
  const responses = [
    { retcode: 0, data: { is_sign: false } },
    { retcode: 0, data: {} },
    { retcode: 0, data: { is_sign: true } },
  ];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(responses.shift());
  };

  const result = await checkInGame(GAMES[1], fetchFn);

  assert.deepEqual(result, { game: "Honkai: Star Rail", status: "signed" });
  assert.deepEqual(calls.map(({ options }) => options.method), ["GET", "POST", "GET"]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { act_id: "e202303301540311" });
  assert.equal(new URL(calls[1].url).pathname, "/event/luna/hkrpg/os/sign");
});

test("checkInGame reports login expiry without exposing response details", async () => {
  const result = await checkInGame(
    GAMES[2],
    async () => jsonResponse({ retcode: -100, message: "Not logged in", data: null }),
  );

  assert.deepEqual(result, { game: "Zenless Zone Zero", status: "login-required" });
});

test("checkInGame fails closed on HTTP, malformed, and API errors", async () => {
  assert.deepEqual(await checkInGame(GAMES[0], async () => jsonResponse({}, 503)), {
    game: "Genshin Impact",
    status: "failed",
    error: "http-503",
  });
  assert.deepEqual(await checkInGame(GAMES[0], async () => jsonResponse({ retcode: "0" })), {
    game: "Genshin Impact",
    status: "failed",
    error: "invalid-response",
  });
  assert.deepEqual(await checkInGame(GAMES[0], async () => jsonResponse({ retcode: 7 })), {
    game: "Genshin Impact",
    status: "failed",
    error: "api-7",
  });
});

test("checkInGame recognizes login expiry during sign and verification", async () => {
  const duringSign = [
    { retcode: 0, data: { is_sign: false } },
    { retcode: -100, data: null },
  ];
  assert.deepEqual(
    await checkInGame(GAMES[1], async () => jsonResponse(duringSign.shift())),
    { game: "Honkai: Star Rail", status: "login-required" },
  );

  const duringVerify = [
    { retcode: 0, data: { is_sign: false } },
    { retcode: 0, data: {} },
    { retcode: -100, data: null },
  ];
  assert.deepEqual(
    await checkInGame(GAMES[2], async () => jsonResponse(duringVerify.shift())),
    { game: "Zenless Zone Zero", status: "login-required" },
  );
});

test("checkInGame fails when the server does not confirm the claimed reward", async () => {
  const responses = [
    { retcode: 0, data: { is_sign: false } },
    { retcode: 0, data: {} },
    { retcode: 0, data: { is_sign: false } },
  ];

  const result = await checkInGame(GAMES[0], async () => jsonResponse(responses.shift()));

  assert.deepEqual(result, { game: "Genshin Impact", status: "failed", error: "not-signed" });
});

test("checkInAll isolates a failed game and continues the other check-ins", async () => {
  const results = await checkInAll(async (_url, options) => {
    if (options.headers["x-rpc-signgame"] === "hk4e") {
      throw new Error("private upstream detail");
    }
    return jsonResponse({ retcode: 0, data: { is_sign: true } });
  });

  assert.deepEqual(results, [
    { game: "Genshin Impact", status: "failed", error: "network" },
    { game: "Honkai: Star Rail", status: "already-signed" },
    { game: "Zenless Zone Zero", status: "already-signed" },
  ]);
});

test("manifest grants only the alarm and API-host access needed for check-in", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.permissions.includes("alarms"), true);
  assert.equal(manifest.permissions.includes("storage"), true);
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.equal(manifest.host_permissions.includes("https://sg-act-public-api.hoyolab.com/*"), true);
});

const memoryStorage = (initial = {}) => {
  const values = structuredClone(initial);
  return {
    get: async (key) => ({ [key]: structuredClone(values[key]) }),
    set: async (updates) => Object.assign(values, structuredClone(updates)),
    values,
  };
};

test("readCheckinState defaults safely and normalizes stored fields", async () => {
  assert.deepEqual(await readCheckinState(memoryStorage()), {
    enabled: true,
    status: "idle",
    lastRunAt: null,
    results: [],
  });

  const storage = memoryStorage({
    [CHECKIN_STORAGE_KEY]: {
      enabled: false,
      status: "login-required",
      lastRunAt: new Date(2026, 7, 24, 9, 10).getTime(),
      results: [
        { game: "Genshin Impact", status: "login-required", error: "private detail" },
        { game: "Unknown", status: "made-up" },
      ],
      ignored: "do not expose",
    },
  });

  assert.deepEqual(await readCheckinState(storage), {
    enabled: false,
    status: "login-required",
    lastRunAt: new Date(2026, 7, 24, 9, 10).getTime(),
    results: [{ game: "Genshin Impact", status: "login-required" }],
  });
});

test("setCheckinEnabled owns both persistent alarms", async () => {
  const storage = memoryStorage();
  const cleared = [];
  const created = [];
  const alarms = {
    clear: async (name) => cleared.push(name),
    get: async () => null,
    create: async (name, info) => created.push({ name, info }),
  };

  await setCheckinEnabled(storage, alarms, false);
  assert.deepEqual(cleared, ALARM_SCHEDULES.map(({ name }) => name));
  assert.equal(storage.values[CHECKIN_STORAGE_KEY].enabled, false);

  const now = new Date(2026, 7, 24, 8, 0);
  await setCheckinEnabled(storage, alarms, true, now);
  assert.equal(created.length, ALARM_SCHEDULES.length);
  assert.equal(storage.values[CHECKIN_STORAGE_KEY].enabled, true);
});

test("summarizeCheckinResults derives safe persistent UI state", () => {
  const lastRunAt = new Date(2026, 7, 24, 9, 10).getTime();
  const previous = { enabled: true, status: "running", lastRunAt: null, results: [] };

  assert.deepEqual(
    summarizeCheckinResults(previous, [
      { game: "Genshin Impact", status: "signed" },
      { game: "Honkai: Star Rail", status: "login-required" },
      { game: "Zenless Zone Zero", status: "failed", error: "http-503" },
    ], lastRunAt),
    {
      enabled: true,
      status: "login-required",
      lastRunAt,
      results: [
        { game: "Genshin Impact", status: "signed" },
        { game: "Honkai: Star Rail", status: "login-required" },
        { game: "Zenless Zone Zero", status: "failed" },
      ],
    },
  );
});

test("popup view covers success, running, login, and paused states", () => {
  const now = new Date(2026, 7, 24, 10, 0);
  const base = {
    enabled: true,
    lastRunAt: new Date(2026, 7, 24, 9, 10).getTime(),
    nextRunAt: new Date(2026, 7, 24, 15, 10).getTime(),
    results: GAMES.map(({ name }) => ({ game: name, status: "already-signed" })),
  };

  assert.deepEqual(buildCheckinView({ ...base, status: "success" }, now), {
    tone: "success",
    chip: "运行正常",
    title: "今日已签到",
    detail: "09:10 完成 · 3 个游戏成功",
    last: "今天 09:10",
    next: "今天 15:10",
    action: "立即检查签到",
    busy: false,
  });
  assert.equal(buildCheckinView({ ...base, status: "running" }, now).busy, true);
  assert.equal(buildCheckinView({ ...base, status: "login-required" }, now).title, "需要登录 HoYoLAB");
  assert.equal(buildCheckinView({ ...base, enabled: false, status: "success" }, now).title, "自动签到已关闭");
});

test("popup time labels are local, compact, and tolerate empty state", () => {
  const now = new Date(2026, 7, 24, 10, 0);
  assert.equal(formatCheckinTime(null, now), "尚无记录");
  assert.equal(formatCheckinTime(new Date(2026, 7, 24, 15, 10).getTime(), now), "今天 15:10");
  assert.equal(formatCheckinTime(new Date(2026, 7, 25, 9, 10).getTime(), now), "明天 09:10");
  assert.equal(formatCheckinTime(new Date(2026, 7, 20, 9, 10).getTime(), now), "8月20日 09:10");
});

test("popup view covers failure and first-run fallbacks", () => {
  const now = new Date(2026, 7, 24, 10, 0);
  const failed = buildCheckinView({
    enabled: true,
    status: "failed",
    results: [{ status: "failed" }, { status: "failed" }],
  }, now);
  assert.equal(failed.detail, "2 个游戏检查失败 · 可再次尝试");
  assert.equal(failed.action, "重新检查签到");

  const idle = buildCheckinView({ enabled: true, status: "idle" }, now);
  assert.equal(idle.title, "尚未运行");
  assert.equal(idle.next, "等待计划");

  const success = buildCheckinView({ enabled: true, status: "success" }, now);
  assert.equal(success.detail, "--:-- 完成 · 0 个游戏成功");
});

test("popup markup exposes native controls and live status", async () => {
  const html = await readFile(new URL("./popup.html", import.meta.url), "utf8");
  const css = await readFile(new URL("./popup.css", import.meta.url), "utf8");

  assert.match(html, /<label[^>]*for="autoCheckin"/);
  assert.match(html, /<input[^>]*id="autoCheckin"[^>]*type="checkbox"/);
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<button[^>]*id="checkinButton"[^>]*type="button"/);
  assert.match(html, /<script[^>]*type="module"[^>]*src="popup\.js"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
