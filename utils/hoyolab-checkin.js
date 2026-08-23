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
