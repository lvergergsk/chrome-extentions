const API_ORIGIN = "https://sg-act-public-api.hoyolab.com";

export const GAMES = Object.freeze([
  {
    name: "Genshin Impact",
    actId: "e202102251931481",
    signGame: "hk4e",
    apiBase: `${API_ORIGIN}/event/sol`,
  },
  {
    name: "Honkai: Star Rail",
    actId: "e202303301540311",
    signGame: "hkrpg",
    apiBase: `${API_ORIGIN}/event/luna/hkrpg/os`,
  },
  {
    name: "Zenless Zone Zero",
    actId: "e202406031448091",
    signGame: "zzz",
    apiBase: `${API_ORIGIN}/event/luna/zzz/os`,
  },
]);

export const ALARM_SCHEDULES = Object.freeze([
  { name: "utils-hoyolab-morning", hour: 9, minute: 10 },
  { name: "utils-hoyolab-afternoon", hour: 15, minute: 10 },
]);

export const CHECKIN_STORAGE_KEY = "hoyolabCheckin";

const CHECKIN_STATUSES = new Set(["idle", "running", "success", "login-required", "failed"]);
const RESULT_STATUSES = new Set(["signed", "already-signed", "login-required", "failed"]);

const cleanResults = (results) => {
  if (!Array.isArray(results)) {
    return [];
  }
  const gameNames = new Set(GAMES.map(({ name }) => name));
  return results
    .filter((result) => gameNames.has(result?.game) && RESULT_STATUSES.has(result?.status))
    .map(({ game, status }) => ({ game, status }));
};

const normalizeCheckinState = (value) => ({
  enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
  status: CHECKIN_STATUSES.has(value?.status) ? value.status : "idle",
  lastRunAt: Number.isFinite(value?.lastRunAt) && value.lastRunAt > 0 ? value.lastRunAt : null,
  results: cleanResults(value?.results),
});

export const readCheckinState = async (storage) => {
  const stored = await storage.get(CHECKIN_STORAGE_KEY);
  return normalizeCheckinState(stored?.[CHECKIN_STORAGE_KEY]);
};

export const setCheckinEnabled = async (storage, alarms, enabled, now = new Date()) => {
  const state = { ...(await readCheckinState(storage)), enabled: Boolean(enabled) };
  await storage.set({ [CHECKIN_STORAGE_KEY]: state });
  if (state.enabled) {
    await ensureCheckinAlarms(alarms, now);
  } else {
    await Promise.all(ALARM_SCHEDULES.map(({ name }) => alarms.clear(name)));
  }
  return state;
};

export const summarizeCheckinResults = (previous, results, lastRunAt = Date.now()) => {
  const safeResults = cleanResults(results);
  const status = safeResults.some((result) => result.status === "login-required")
    ? "login-required"
    : safeResults.some((result) => result.status === "failed")
      ? "failed"
      : "success";
  return {
    ...normalizeCheckinState(previous),
    status,
    lastRunAt,
    results: safeResults,
  };
};

export const nextLocalAlarm = (hour, minute, now = new Date()) => {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next < now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
};

export const ensureCheckinAlarms = async (alarms, now = new Date()) => {
  for (const schedule of ALARM_SCHEDULES) {
    if (await alarms.get(schedule.name)) {
      continue;
    }
    await alarms.create(schedule.name, {
      when: nextLocalAlarm(schedule.hour, schedule.minute, now),
      periodInMinutes: 24 * 60,
      persistAcrossSessions: true,
    });
  }
};

const request = async (game, path, method, fetchFn) => {
  const url = new URL(`${game.apiBase}/${path}`);
  url.searchParams.set("lang", "en-us");
  if (method === "GET") {
    url.searchParams.set("act_id", game.actId);
  }
  const options = {
    method,
    credentials: "include",
    headers: { "x-rpc-signgame": game.signGame },
  };
  if (method === "POST") {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify({ act_id: game.actId });
  }

  try {
    const response = await fetchFn(url, options);
    if (!response.ok) {
      return { error: `http-${response.status}` };
    }
    const payload = await response.json();
    if (!Number.isInteger(payload?.retcode)) {
      return { error: "invalid-response" };
    }
    return { payload };
  } catch {
    return { error: "network" };
  }
};

const readState = async (game, fetchFn) => {
  const result = await request(game, "info", "GET", fetchFn);
  if (result.error || result.payload.retcode !== 0) {
    return result;
  }
  if (typeof result.payload.data?.is_sign !== "boolean") {
    return { error: "invalid-response" };
  }
  return result;
};

const failed = (game, error) => ({ game: game.name, status: "failed", error });

export const checkInGame = async (game, fetchFn = fetch) => {
  const before = await readState(game, fetchFn);
  if (before.payload?.retcode === -100) {
    return { game: game.name, status: "login-required" };
  }
  if (before.error) {
    return failed(game, before.error);
  }
  if (before.payload.retcode !== 0) {
    return failed(game, `api-${before.payload.retcode}`);
  }
  if (before.payload.data.is_sign) {
    return { game: game.name, status: "already-signed" };
  }

  const sign = await request(game, "sign", "POST", fetchFn);
  if (sign.payload?.retcode === -100) {
    return { game: game.name, status: "login-required" };
  }
  if (sign.error) {
    return failed(game, sign.error);
  }

  const after = await readState(game, fetchFn);
  if (after.payload?.retcode === -100) {
    return { game: game.name, status: "login-required" };
  }
  if (after.error) {
    return failed(game, after.error);
  }
  if (after.payload.retcode === 0 && after.payload.data.is_sign) {
    return { game: game.name, status: "signed" };
  }
  return failed(game, sign.payload.retcode === 0 ? "not-signed" : `api-${sign.payload.retcode}`);
};

export const checkInAll = async (fetchFn = fetch) => {
  const results = [];
  for (const game of GAMES) {
    results.push(await checkInGame(game, fetchFn));
  }
  return results;
};
