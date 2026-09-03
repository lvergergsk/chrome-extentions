const CODES_API = "https://hoyo-codes.seria.moe/codes";
const ROLES_API = "https://sg-public-api.hoyolab.com/binding/api/getUserGameRolesByLtoken";

// The hoyoverse.com redemption hosts want a cookie_token the browser session does
// not carry; these hoyolab.com "Hyl" endpoints accept the HoYoLAB ltoken instead.
export const REDEEM_GAMES = Object.freeze([
  {
    name: "Genshin Impact",
    codesGame: "genshin",
    gameBiz: "hk4e_global",
    endpoint: "https://sg-hk4e-api.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
  },
  {
    name: "Honkai: Star Rail",
    codesGame: "hkrpg",
    gameBiz: "hkrpg_global",
    endpoint: "https://sg-hkrpg-api.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
  },
  {
    name: "Zenless Zone Zero",
    codesGame: "nap",
    gameBiz: "nap_global",
    endpoint: "https://public-operation-nap.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
  },
]);

export const REDEEM_STORAGE_KEY = "hoyolabRedeem";

// miHoYo rejects a second redemption within ~5s of the last one with -2016.
export const REDEEM_COOLDOWN_MS = 6000;

// One page of history is plenty to keep a retired code from being retried.
const DONE_LIMIT = 200;

const REDEEM_STATUSES = new Set(["idle", "running", "success", "login-required", "failed"]);
const GAME_STATUSES = new Set(["done", "login-required", "failed"]);

const RETCODE_STATUS = new Map([
  [0, "redeemed"],
  [-2017, "used"],
  [-2018, "used"],
  [-2002, "used"],
  [-2001, "expired"],
  // "reached its max usage limit" — exhausted for everyone, never worth a retry.
  [-2006, "expired"],
  [-2003, "invalid"],
  [-2004, "invalid"],
  [-1065, "invalid"],
  [-2016, "cooldown"],
  [-1071, "login-required"],
  [-100, "login-required"],
]);

// Terminal outcomes are remembered so a code is never sent twice.
const TERMINAL = new Set(["redeemed", "used", "expired", "invalid"]);

const isCode = (value) => typeof value === "string" && /^[A-Za-z0-9]{4,32}$/.test(value);

const cleanDone = (value) => {
  const done = {};
  for (const game of REDEEM_GAMES) {
    const codes = Array.isArray(value?.[game.codesGame]) ? value[game.codesGame].filter(isCode) : [];
    done[game.codesGame] = [...new Set(codes)].slice(-DONE_LIMIT);
  }
  return done;
};

const cleanResults = (results) => {
  if (!Array.isArray(results)) {
    return [];
  }
  const names = new Set(REDEEM_GAMES.map(({ name }) => name));
  return results
    .filter((result) => names.has(result?.game) && GAME_STATUSES.has(result?.status))
    .map(({ game, status, redeemed, error }) => ({
      game,
      status,
      redeemed: Number.isInteger(redeemed) && redeemed > 0 ? redeemed : 0,
      // Kept so the popup can say why a run failed instead of just that it did.
      ...(typeof error === "string" && error ? { error: error.slice(0, 40) } : {}),
    }));
};

const normalizeRedeemState = (value) => ({
  enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
  status: REDEEM_STATUSES.has(value?.status) ? value.status : "idle",
  lastRunAt: Number.isFinite(value?.lastRunAt) && value.lastRunAt > 0 ? value.lastRunAt : null,
  results: cleanResults(value?.results),
  done: cleanDone(value?.done),
});

export const readRedeemState = async (storage) => {
  const stored = await storage.get(REDEEM_STORAGE_KEY);
  return normalizeRedeemState(stored?.[REDEEM_STORAGE_KEY]);
};

export const setRedeemEnabled = async (storage, enabled) => {
  const state = { ...(await readRedeemState(storage)), enabled: Boolean(enabled) };
  await storage.set({ [REDEEM_STORAGE_KEY]: state });
  return state;
};

export const summarizeRedeemResults = (previous, { results, done }, lastRunAt = Date.now()) => {
  const safeResults = cleanResults(results);
  const status = safeResults.some((result) => result.status === "login-required")
    ? "login-required"
    : safeResults.some((result) => result.status === "failed")
      ? "failed"
      : "success";
  return {
    ...normalizeRedeemState(previous),
    status,
    lastRunAt,
    results: safeResults,
    done: cleanDone(done),
  };
};

const readJson = async (fetchFn, url, options) => {
  try {
    const response = await fetchFn(url, options);
    if (!response.ok) {
      return { error: `http-${response.status}` };
    }
    const payload = await response.json();
    return payload && typeof payload === "object" ? { payload } : { error: "invalid-response" };
  } catch {
    return { error: "network" };
  }
};

export const fetchCodes = async (game, fetchFn = fetch) => {
  const url = new URL(CODES_API);
  url.searchParams.set("game", game.codesGame);
  const { payload, error } = await readJson(fetchFn, url, { credentials: "omit" });
  if (error) {
    return { error };
  }
  if (!Array.isArray(payload.codes)) {
    return { error: "invalid-response" };
  }
  return {
    codes: [
      ...new Set(
        payload.codes
          .filter((entry) => entry?.status === "OK")
          .map((entry) => entry?.code)
          .filter(isCode)
          .map((code) => code.toUpperCase()),
      ),
    ],
  };
};

export const fetchRole = async (game, fetchFn = fetch) => {
  const url = new URL(ROLES_API);
  url.searchParams.set("game_biz", game.gameBiz);
  const { payload, error } = await readJson(fetchFn, url, { credentials: "include" });
  if (error) {
    return { error };
  }
  if (payload.retcode === -100) {
    return { error: "login-required" };
  }
  // An account can hold several roles for one game; the played one is the one
  // with progress, not necessarily the first the API lists.
  const role = (Array.isArray(payload.data?.list) ? payload.data.list : [])
    .slice()
    .sort((left, right) => (right.level ?? 0) - (left.level ?? 0))[0];
  if (!role?.game_uid || !role?.region) {
    return { error: payload.retcode === 0 ? "no-role" : `api-${payload.retcode}` };
  }
  return { role: { uid: String(role.game_uid), region: String(role.region) } };
};

export const redeemCode = async (game, role, code, fetchFn = fetch) => {
  const url = new URL(game.endpoint);
  url.searchParams.set("lang", "en");
  url.searchParams.set("sLangKey", "en-us");
  url.searchParams.set("game_biz", game.gameBiz);
  url.searchParams.set("uid", role.uid);
  url.searchParams.set("region", role.region);
  url.searchParams.set("cdkey", code);

  const { payload, error } = await readJson(fetchFn, url, {
    credentials: "include",
    headers: { "x-rpc-client_type": "4", "x-rpc-app_version": "2.34.1" },
  });
  if (error) {
    return { status: "failed", error };
  }
  const status = RETCODE_STATUS.get(payload.retcode);
  return status ? { status } : { status: "failed", error: `api-${payload.retcode}` };
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const redeemGame = async (game, doneCodes, fetchFn = fetch, sleep = sleepMs, onProgress) => {
  const listed = await fetchCodes(game, fetchFn);
  if (listed.error) {
    return {
      result: { game: game.name, status: "failed", redeemed: 0, error: `codes-${listed.error}` },
      done: doneCodes,
    };
  }
  const pending = listed.codes.filter((code) => !doneCodes.includes(code));
  if (pending.length === 0) {
    return { result: { game: game.name, status: "done", redeemed: 0 }, done: doneCodes };
  }

  // Only worth a session check once there is something to redeem.
  const found = await fetchRole(game, fetchFn);
  if (found.error) {
    return {
      result: {
        game: game.name,
        status: found.error === "login-required" ? "login-required" : "failed",
        redeemed: 0,
        error: `role-${found.error}`,
      },
      done: doneCodes,
    };
  }

  const done = [...doneCodes];
  let redeemed = 0;
  let status = "done";
  let error = "";
  for (const [index, code] of pending.entries()) {
    if (index > 0) {
      await sleep(REDEEM_COOLDOWN_MS);
    }
    let attempt = await redeemCode(game, found.role, code, fetchFn);
    if (attempt.status === "cooldown") {
      await sleep(REDEEM_COOLDOWN_MS);
      attempt = await redeemCode(game, found.role, code, fetchFn);
    }
    if (attempt.status === "login-required") {
      // The session died mid-run; every remaining code would fail the same way.
      return { result: { game: game.name, status: "login-required", redeemed }, done };
    }
    if (TERMINAL.has(attempt.status)) {
      done.push(code);
      if (attempt.status === "redeemed") {
        redeemed += 1;
      }
      // A whole run outlives the worker's guaranteed lifetime, so every settled
      // code is banked immediately rather than only at the end.
      // ponytail: per-code write; batch per game if storage churn ever matters.
      await onProgress?.(done);
    } else {
      status = "failed";
      error = attempt.error || attempt.status;
    }
  }
  return {
    result: { game: game.name, status, redeemed, ...(error ? { error } : {}) },
    done: done.slice(-DONE_LIMIT),
  };
};

export const redeemAll = async (state, fetchFn = fetch, sleep = sleepMs, onProgress) => {
  const results = [];
  const done = { ...cleanDone(state?.done) };
  for (const game of REDEEM_GAMES) {
    const bank = onProgress && ((codes) => onProgress({ ...done, [game.codesGame]: codes }));
    const outcome = await redeemGame(game, done[game.codesGame], fetchFn, sleep, bank);
    results.push(outcome.result);
    done[game.codesGame] = outcome.done;
  }
  return { results, done };
};
