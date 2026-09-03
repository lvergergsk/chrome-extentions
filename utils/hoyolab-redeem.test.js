import assert from "node:assert/strict";
import test from "node:test";
import {
  REDEEM_GAMES,
  REDEEM_STORAGE_KEY,
  fetchCodes,
  fetchRole,
  readRedeemState,
  redeemAll,
  redeemCode,
  redeemGame,
  setRedeemEnabled,
  summarizeRedeemResults,
} from "./hoyolab-redeem.js";
import { buildRedeemView } from "./hoyolab-popup.js";

const [GENSHIN, STAR_RAIL] = REDEEM_GAMES;

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const roleResponse = jsonResponse({
  retcode: 0,
  data: { list: [{ game_uid: "800000001", region: "os_euro" }] },
});

const codesResponse = (codes) =>
  jsonResponse({ codes: codes.map((code, id) => ({ id, code, status: "OK" })) });

// Routes the three call shapes redeemGame makes so a test only states retcodes.
const stubFetch = (codes, retcodes, calls = []) => {
  const queue = [...retcodes];
  return async (url, options) => {
    const href = String(url);
    calls.push({ href, options });
    if (href.startsWith("https://hoyo-codes.seria.moe/")) {
      return codesResponse(codes);
    }
    if (href.includes("getUserGameRoles")) {
      return roleResponse;
    }
    return jsonResponse({ retcode: queue.shift() ?? 0, data: null });
  };
};

const noSleep = async () => {};

test("fetchCodes keeps only usable codes and drops duplicates and junk", async () => {
  const fetchFn = async () =>
    jsonResponse({
      codes: [
        { code: "genshingift", status: "OK" },
        { code: "GENSHINGIFT", status: "OK" },
        { code: "DEADCODE1", status: "NOT_OK" },
        { code: "bad code!", status: "OK" },
        { code: null, status: "OK" },
      ],
    });

  assert.deepEqual(await fetchCodes(GENSHIN, fetchFn), { codes: ["GENSHINGIFT"] });
});

test("fetchRole reports a dead session instead of a role", async () => {
  const expired = async () => jsonResponse({ retcode: -100, data: null, message: "Login expired" });
  assert.deepEqual(await fetchRole(GENSHIN, expired), { error: "login-required" });

  const bound = async () => roleResponse;
  assert.deepEqual(await fetchRole(GENSHIN, bound), { role: { uid: "800000001", region: "os_euro" } });
});

test("redeemCode carries the session to the ltoken-backed hoyolab endpoint", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ href: String(url), options });
    return jsonResponse({ retcode: 0 });
  };
  const role = { uid: "800000001", region: "os_euro" };

  await redeemCode(GENSHIN, role, "EXAMPLECODE1", fetchFn);
  await redeemCode(STAR_RAIL, role, "EXAMPLECODE1", fetchFn);

  // hoyoverse.com hosts demand a cookie_token the browser session lacks.
  assert.deepEqual(
    calls.map(({ href }) => new URL(href).hostname),
    ["sg-hk4e-api.hoyolab.com", "sg-hkrpg-api.hoyolab.com"],
  );
  assert.match(calls[0].href, /webExchangeCdkeyHyl/);
  assert.match(calls[0].href, /game_biz=hk4e_global&uid=800000001&region=os_euro&cdkey=EXAMPLECODE1/);
  assert.equal(calls[0].options.credentials, "include");
  assert.match(calls[1].href, /game_biz=hkrpg_global/);
});

test("redeemCode maps every terminal retcode and treats an unknown one as a failure", async () => {
  const map = async (retcode) => {
    const fetchFn = async () => jsonResponse({ retcode });
    return (await redeemCode(GENSHIN, { uid: "1", region: "os_euro" }, "EXAMPLECODE1", fetchFn)).status;
  };

  assert.equal(await map(0), "redeemed");
  assert.equal(await map(-2017), "used");
  assert.equal(await map(-2001), "expired");
  assert.equal(await map(-2006), "expired");
  assert.equal(await map(-2003), "invalid");
  assert.equal(await map(-1065), "invalid");
  assert.equal(await map(-2016), "cooldown");
  assert.equal(await map(-1071), "login-required");
  assert.equal(await map(-9999), "failed");
});

test("redeemGame never resends a code it already settled", async () => {
  const calls = [];
  const fetchFn = stubFetch(["OLDCODE1", "NEWCODE1"], [0], calls);

  const outcome = await redeemGame(GENSHIN, ["OLDCODE1"], fetchFn, noSleep);

  const redeemCalls = calls.filter(({ href }) => href.includes("webExchangeCdkey"));
  assert.equal(redeemCalls.length, 1);
  assert.match(redeemCalls[0].href, /cdkey=NEWCODE1/);
  assert.deepEqual(outcome.result, { game: GENSHIN.name, status: "done", redeemed: 1 });
  assert.deepEqual(outcome.done, ["OLDCODE1", "NEWCODE1"]);
});

test("redeemGame skips the session lookup entirely when nothing is pending", async () => {
  const calls = [];
  const fetchFn = stubFetch(["OLDCODE1"], [], calls);

  const outcome = await redeemGame(GENSHIN, ["OLDCODE1"], fetchFn, noSleep);

  assert.deepEqual(calls.map(({ href }) => href.includes("getUserGameRoles")), [false]);
  assert.deepEqual(outcome.result, { game: GENSHIN.name, status: "done", redeemed: 0 });
});

test("redeemGame retries once through a cooldown and remembers a used code", async () => {
  const calls = [];
  const fetchFn = stubFetch(["NEWCODE1", "NEWCODE2"], [-2016, 0, -2017], calls);
  const slept = [];

  const outcome = await redeemGame(GENSHIN, [], fetchFn, async (ms) => slept.push(ms));

  assert.equal(calls.filter(({ href }) => href.includes("webExchangeCdkey")).length, 3);
  assert.deepEqual(slept, [6000, 6000]);
  assert.deepEqual(outcome.result, { game: GENSHIN.name, status: "done", redeemed: 1 });
  assert.deepEqual(outcome.done, ["NEWCODE1", "NEWCODE2"]);
});

test("redeemGame stops at a dead session and keeps the untried codes pending", async () => {
  const calls = [];
  const fetchFn = stubFetch(["NEWCODE1", "NEWCODE2"], [-1071], calls);

  const outcome = await redeemGame(GENSHIN, [], fetchFn, noSleep);

  assert.equal(calls.filter(({ href }) => href.includes("webExchangeCdkey")).length, 1);
  assert.deepEqual(outcome.result, { game: GENSHIN.name, status: "login-required", redeemed: 0 });
  assert.deepEqual(outcome.done, []);
});

test("redeemGame leaves a failed code pending and reports why", async () => {
  const fetchFn = stubFetch(["NEWCODE1"], [-9999]);

  const outcome = await redeemGame(GENSHIN, [], fetchFn, noSleep);

  assert.deepEqual(outcome.result, { game: GENSHIN.name, status: "failed", redeemed: 0, error: "api--9999" });
  assert.deepEqual(outcome.done, []);
});

test("redeemGame banks each settled code before the next cooldown", async () => {
  const fetchFn = stubFetch(["NEWCODE1", "NEWCODE2"], [0, 0]);
  const banked = [];

  await redeemGame(GENSHIN, [], fetchFn, noSleep, async (done) => banked.push([...done]));

  // A run outlasts the worker, so progress cannot wait for the end.
  assert.deepEqual(banked, [["NEWCODE1"], ["NEWCODE1", "NEWCODE2"]]);
});

test("fetchRole picks the played role, not whichever the API lists first", async () => {
  const fetchFn = async () =>
    jsonResponse({
      retcode: 0,
      data: {
        list: [
          { game_uid: "800000002", region: "prod_official_usa", level: 1 },
          { game_uid: "800000001", region: "prod_official_asia", level: 70 },
        ],
      },
    });

  assert.deepEqual(await fetchRole(STAR_RAIL, fetchFn), {
    role: { uid: "800000001", region: "prod_official_asia" },
  });
});

test("a broken code feed fails that game without touching the account", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    return jsonResponse({ error: "boom" }, 503);
  };

  const outcome = await redeemGame(GENSHIN, ["OLDCODE1"], fetchFn, noSleep);

  assert.equal(calls.length, 1);
  assert.deepEqual(outcome.result, {
    game: GENSHIN.name,
    status: "failed",
    redeemed: 0,
    error: "codes-http-503",
  });
  assert.deepEqual(outcome.done, ["OLDCODE1"]);
});

test("redeemAll covers every game and carries its own history forward", async () => {
  const fetchFn = stubFetch(["NEWCODE1"], [0, 0, 0]);

  const outcome = await redeemAll({ done: { genshin: [], hkrpg: [], nap: [] } }, fetchFn, noSleep);

  assert.deepEqual(
    outcome.results,
    REDEEM_GAMES.map((game) => ({ game: game.name, status: "done", redeemed: 1 })),
  );
  assert.deepEqual(outcome.done, { genshin: ["NEWCODE1"], hkrpg: ["NEWCODE1"], nap: ["NEWCODE1"] });
});

test("readRedeemState repairs stored junk and defaults to enabled", async () => {
  const storage = {
    get: async () => ({
      [REDEEM_STORAGE_KEY]: {
        status: "bogus",
        lastRunAt: -1,
        results: [
          { game: "Not A Game", status: "done" },
          { game: GENSHIN.name, status: "done", redeemed: 2 },
        ],
        done: { genshin: ["OK1CODE", "bad code!", "OK1CODE"], nap: "nope" },
      },
    }),
  };

  assert.deepEqual(await readRedeemState(storage), {
    enabled: true,
    status: "idle",
    lastRunAt: null,
    results: [{ game: GENSHIN.name, status: "done", redeemed: 2 }],
    done: { genshin: ["OK1CODE"], hkrpg: [], nap: [] },
  });
});

test("setRedeemEnabled persists the switch without disturbing history", async () => {
  let written;
  const storage = {
    get: async () => ({ [REDEEM_STORAGE_KEY]: { done: { genshin: ["OLDCODE1"] } } }),
    set: async (value) => {
      written = value;
    },
  };

  const state = await setRedeemEnabled(storage, false);

  assert.equal(state.enabled, false);
  assert.deepEqual(written[REDEEM_STORAGE_KEY].done.genshin, ["OLDCODE1"]);
});

test("summarizeRedeemResults reports the worst outcome across games", () => {
  const done = { genshin: ["OLDCODE1"], hkrpg: [], nap: [] };
  const results = (statuses) => statuses.map((status, index) => ({ game: REDEEM_GAMES[index].name, status }));

  assert.equal(summarizeRedeemResults({}, { results: results(["done", "done", "done"]), done }, 1).status, "success");
  assert.equal(summarizeRedeemResults({}, { results: results(["done", "failed", "done"]), done }, 1).status, "failed");
  assert.equal(
    summarizeRedeemResults({}, { results: results(["failed", "login-required", "done"]), done }, 1).status,
    "login-required",
  );
});

test("buildRedeemView describes each state to the operator", () => {
  const now = new Date(2026, 7, 24, 12, 0);
  const at = new Date(2026, 7, 24, 9, 10).getTime();

  assert.equal(buildRedeemView(undefined, now).busy, true);
  assert.equal(buildRedeemView({ enabled: false, status: "success" }, now).detail, "不自动兑换 · 可随时开启");
  assert.equal(buildRedeemView({ enabled: true, status: "running" }, now).busy, true);
  assert.equal(buildRedeemView({ enabled: true, status: "login-required" }, now).detail, "需要登录 HoYoverse 账号");
  assert.equal(
    buildRedeemView(
      { enabled: true, status: "success", lastRunAt: at, results: [{ redeemed: 2 }, { redeemed: 1 }] },
      now,
    ).detail,
    "今天 09:10 兑换 3 个",
  );
  assert.equal(
    buildRedeemView({ enabled: true, status: "success", lastRunAt: at, results: [] }, now).detail,
    "没有新的兑换码",
  );
});
