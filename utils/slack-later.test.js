import assert from "node:assert/strict";
import test from "node:test";
import { addLater, CHANNEL, listLater, markLater, removeLater, resetSlackLaterToken } from "./slack-later.js";
import { validateRequest } from "./browser-bridge.js";

const ROOT = "1790911139.927739";
const boot = '<script>var boot_data = {"api_token":"xoxc-1-2-3-fake","team_id":"T1"};</script>';

function slack(responses) {
  const calls = [];
  const fetchFn = async (url, options) => {
    if (url.endsWith("/ssb/redirect")) {
      calls.push({ url });
      assert.equal(options.credentials, "include");
      return new Response(boot);
    }
    const args = Object.fromEntries(options.body);
    calls.push({ url, args });
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.equal(options.redirect, "error");
    assert.equal(args.token, "xoxc-1-2-3-fake");
    return Response.json(responses.shift());
  };
  return { calls, fetchFn };
}

const api = (calls) => calls.filter(({ args }) => args)
  .map(({ url, args }) => ({ method: url.split("/").pop(), ...args }));

test("list reports every Later tab for session-channel messages and reuses the token", async () => {
  resetSlackLaterToken();
  const { calls, fetchFn } = slack([
    { ok: true, saved_items: [
      { item_type: "message", item_id: CHANNEL, ts: ROOT },
      { item_type: "message", item_id: "C0OTHER0000", ts: ROOT },
      { item_type: "reminder", item_id: "Sa123", ts: ROOT },
      { item_type: "message", item_id: CHANNEL, ts: "../escape" },
    ], response_metadata: { next_cursor: "page2" } },
    { ok: true, saved_items: [{ item_type: "message", item_id: CHANNEL, ts: "1790900000.000001" }] },
    { ok: true, saved_items: [{ item_type: "message", item_id: CHANNEL, ts: "1790900000.000002" }] },
    { ok: true, saved_items: [{ item_type: "message", item_id: CHANNEL, ts: "1790900000.000003" }] },
  ]);
  assert.deepEqual(await listLater(fetchFn), [
    { ts: ROOT, state: "in_progress" },
    { ts: "1790900000.000001", state: "in_progress" },
    { ts: "1790900000.000002", state: "completed" },
    { ts: "1790900000.000003", state: "archived" },
  ]);
  assert.equal(calls.filter(({ url }) => url.endsWith("/ssb/redirect")).length, 1);
  assert.deepEqual(api(calls).map(({ filter, cursor }) => [filter, cursor]), [
    ["saved", undefined], ["saved", "page2"], ["completed", undefined], ["archived", undefined],
  ]);
  assert.equal(calls[1].url, "https://home-fa43516.slack.com/api/saved.list");
});

test("add, mark and remove target only the fixed channel with the web client's arguments", async () => {
  resetSlackLaterToken();
  const { calls, fetchFn } = slack([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  assert.deepEqual(await addLater(ROOT, fetchFn), { ts: ROOT });
  assert.deepEqual(await markLater(ROOT, "uncompleted", fetchFn), { ts: ROOT, mark: "uncompleted" });
  assert.deepEqual(await markLater(ROOT, "unarchived", fetchFn), { ts: ROOT, mark: "unarchived" });
  assert.deepEqual(await removeLater(ROOT, fetchFn), { ts: ROOT });
  const base = { item_type: "message", item_id: CHANNEL, ts: ROOT, token: "xoxc-1-2-3-fake" };
  assert.deepEqual(api(calls), [
    { method: "saved.add", ...base },
    { method: "saved.update", ...base, mark: "uncompleted", date_due: "0" },
    { method: "saved.update", ...base, mark: "unarchived" },
    { method: "saved.delete", ...base },
  ]);
});

test("an expired token is refetched once; other errors expose only Slack's code", async () => {
  resetSlackLaterToken();
  const expired = slack([{ ok: false, error: "invalid_auth" }, { ok: true }]);
  await addLater(ROOT, expired.fetchFn);
  assert.equal(expired.calls.filter(({ url }) => url.endsWith("/ssb/redirect")).length, 2);

  resetSlackLaterToken();
  const failed = slack([{ ok: false, error: "saved_not_found", detail: "xoxc-1-2-3-fake" }]);
  await assert.rejects(removeLater(ROOT, failed.fetchFn), (error) => {
    assert.equal(error.message, "Slack Later saved.delete failed: saved_not_found");
    return true;
  });

  resetSlackLaterToken();
  await assert.rejects(listLater(async () => new Response("signed out")),
    /Slack Later login failed: not_authed/);
  await assert.rejects(listLater(async () => { throw new Error("xoxc-1-2-3-fake"); }),
    (error) => !error.message.includes("xoxc") && /unavailable/.test(error.message));
});

test("bridge accepts only a message timestamp and a known Later mark", () => {
  const request = (method, params) => ({ id: "a".repeat(32), method, params });
  assert.doesNotThrow(() => validateRequest(request("slack.later.list", {})));
  assert.doesNotThrow(() => validateRequest(request("slack.later.add", { ts: ROOT })));
  assert.doesNotThrow(() => validateRequest(request("slack.later.remove", { ts: ROOT })));
  for (const mark of ["completed", "uncompleted", "archived", "unarchived"]) {
    assert.doesNotThrow(() => validateRequest(request("slack.later.mark", { ts: ROOT, mark })));
  }
  for (const [method, params] of [
    ["slack.later.list", { channel: CHANNEL }],
    ["slack.later.add", {}],
    ["slack.later.add", { ts: "1790911139" }],
    ["slack.later.add", { ts: ROOT, channel: "C0OTHER0000" }],
    ["slack.later.remove", { ts: "x" }],
    ["slack.later.mark", { ts: ROOT }],
    ["slack.later.mark", { ts: ROOT, mark: "deleted" }],
    ["slack.later.mark", { ts: ROOT, completed: true }],
  ]) {
    assert.throws(() => validateRequest(request(method, params)));
  }
});
