import test from "node:test";
import assert from "node:assert/strict";
import { createPawchiveWatch, WATCH_KEY, WATCH_ALARM } from "./pawchive-watch.js";

const author = { platform: "fanbox", authorId: "123" };
const url = (id) => `https://pawchive.pw/fanbox/user/123/post/${id}`;

const fake = ({ urls = [], failed = [] } = {}) => {
  const data = {}, alarms = new Map(), submitted = [], calls = [];
  const api = {
    storage: { local: { get: async (key) => structuredClone({ [key]: data[key] }), set: async (values) => Object.assign(data, structuredClone(values)) } },
    alarms: { get: async (name) => alarms.get(name), create: async (name, options) => alarms.set(name, options) },
  };
  const service = { requested: async () => ["1", ...submitted], submit: async (posts) => { submitted.push(...posts.map((post) => post.postId)); } };
  const parse = async (op, payload) => {
    calls.push({ op, ...payload });
    if (op === "posts") return { urls: urls.filter((item) => !payload.known.includes(item.split("/").at(-1))) };
    return { posts: payload.urls.filter((item) => !failed.includes(item)).map((item) => ({ ...author, postId: item.split("/").at(-1), files: [] })) };
  };
  parse.close = async () => calls.push({ op: "close" });
  return { api, data, alarms, submitted, calls, watch: createPawchiveWatch(service, parse, api) };
};

test("watching checks at once, oldest first; the next check only retries what failed", async () => {
  const urls = Array.from({ length: 25 }, (_, i) => url(100 - i));
  const env = fake({ urls, failed: [url(90)] });
  await env.watch.setWatched(author, true);
  await env.watch.run(author); // queued behind the check that watching started
  assert.deepEqual(env.calls[0].known, ["1"]);
  assert.equal(env.submitted[0], "76", "oldest new post is submitted first");
  assert.equal(env.submitted.length, 24);
  assert.ok(!env.submitted.includes("90"), "a failed post stays unrequested for the next check");
  assert.equal(env.calls.filter((call) => call.op === "load").length, 3);
  assert.deepEqual(env.calls.at(-2).urls, [url(90)]);
  const { watch } = await env.watch.status(author);
  assert.equal(watch.found, 0);
  assert.equal(watch.failed, 1);
  assert.equal(watch.error, null);
  assert.equal(env.calls.at(-1).op, "close");
});

test("errors are recorded, unwatched authors are skipped, and the daily alarm is created once", async () => {
  const env = fake();
  await env.watch.setWatched(author, true);
  await env.watch.setWatched({ platform: "patreon", authorId: "9" }, true);
  await env.watch.setWatched({ platform: "patreon", authorId: "9" }, false);
  await env.watch.run();
  assert.deepEqual(Object.keys(env.data[WATCH_KEY].authors), ["fanbox/123"]);
  const failing = createPawchiveWatch({ requested: async () => [] }, async () => { throw new Error("page-unavailable"); }, env.api);
  await failing.run();
  assert.equal((await failing.status(author)).watch.error, "page-unavailable");
  await env.watch.schedule();
  env.alarms.set(WATCH_ALARM, { periodInMinutes: 1 });
  await env.watch.schedule();
  assert.equal(env.alarms.get(WATCH_ALARM).periodInMinutes, 1, "an existing alarm is left alone");
});
