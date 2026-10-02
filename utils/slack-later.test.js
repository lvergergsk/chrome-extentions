import assert from "node:assert/strict";
import test from "node:test";
import { addLater, CHANNEL, listLater, markLater, resetSlackLaterToken } from "./slack-later.js";
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

test("list keeps only in-progress session-channel messages and reuses the token", async () => {
  resetSlackLaterToken();
  const { calls, fetchFn } = slack([
    { ok: true, saved_items: [
      { item_type: "message", item_id: CHANNEL, ts: ROOT, state: "in_progress" },
      { item_type: "message", item_id: "C0OTHER0000", ts: ROOT },
      { item_type: "reminder", item_id: "Sa123", ts: ROOT },
      { item_type: "message", item_id: CHANNEL, ts: "../escape" },
    ], response_metadata: { next_cursor: "page2" } },
    { ok: true, saved_items: [{ item_type: "message", item_id: CHANNEL, ts: "1790900000.000001" }] },
  ]);
  assert.deepEqual(await listLater(fetchFn), [{ ts: ROOT }, { ts: "1790900000.000001" }]);
  assert.equal(calls.filter(({ url }) => url.endsWith("/ssb/redirect")).length, 1);
  assert.deepEqual(calls[1].args, { filter: "saved", limit: "50", include_tombstones: "false",
    token: "xoxc-1-2-3-fake" });
  assert.equal(calls[2].args.cursor, "page2");
  assert.equal(calls[2].url, "https://home-fa43516.slack.com/api/saved.list");
});

test("add and mark target only the fixed channel with the web client's arguments", async () => {
  resetSlackLaterToken();
  const { calls, fetchFn } = slack([{ ok: true }, { ok: true }, { ok: true }]);
  assert.deepEqual(await addLater(ROOT, fetchFn), { ts: ROOT });
  assert.deepEqual(await markLater(ROOT, true, fetchFn), { ts: ROOT, completed: true });
  assert.deepEqual(await markLater(ROOT, false, fetchFn), { ts: ROOT, completed: false });
  const [add, done, undo] = calls.slice(1).map(({ url, args }) => ({ method: url.split("/").pop(), ...args }));
  assert.deepEqual(add, { method: "saved.add", item_type: "message", item_id: CHANNEL, ts: ROOT,
    token: "xoxc-1-2-3-fake" });
  assert.equal(done.method, "saved.update");
  assert.equal(done.mark, "completed");
  assert.equal(done.date_due, "0");
  assert.equal(undo.mark, "uncompleted");
});

test("an expired token is refetched once; other errors expose only Slack's code", async () => {
  resetSlackLaterToken();
  const expired = slack([{ ok: false, error: "invalid_auth" }, { ok: true }]);
  await addLater(ROOT, expired.fetchFn);
  assert.equal(expired.calls.filter(({ url }) => url.endsWith("/ssb/redirect")).length, 2);

  resetSlackLaterToken();
  const failed = slack([{ ok: false, error: "not_in_channel", detail: "xoxc-1-2-3-fake" }]);
  await assert.rejects(addLater(ROOT, failed.fetchFn), (error) => {
    assert.equal(error.message, "Slack Later saved.add failed: not_in_channel");
    return true;
  });

  resetSlackLaterToken();
  await assert.rejects(listLater(async () => new Response("signed out")),
    /Slack Later login failed: not_authed/);
  await assert.rejects(listLater(async () => { throw new Error("xoxc-1-2-3-fake"); }),
    (error) => !error.message.includes("xoxc") && /unavailable/.test(error.message));
});

test("bridge accepts only a message timestamp and an explicit completion flag", () => {
  const request = (method, params) => ({ id: "a".repeat(32), method, params });
  assert.doesNotThrow(() => validateRequest(request("slack.later.list", {})));
  assert.doesNotThrow(() => validateRequest(request("slack.later.add", { ts: ROOT })));
  assert.doesNotThrow(() => validateRequest(request("slack.later.mark", { ts: ROOT, completed: true })));
  for (const [method, params] of [
    ["slack.later.list", { channel: CHANNEL }],
    ["slack.later.add", {}],
    ["slack.later.add", { ts: "1790911139" }],
    ["slack.later.add", { ts: ROOT, channel: "C0OTHER0000" }],
    ["slack.later.mark", { ts: ROOT }],
    ["slack.later.mark", { ts: ROOT, completed: "true" }],
  ]) {
    assert.throws(() => validateRequest(request(method, params)));
  }
});
