import test from "node:test";
import assert from "node:assert/strict";
import { createPawchiveService, STORAGE_KEY } from "./pawchive-downloads.js";

const hash = "aabb" + "c".repeat(60);
const url = `https://file.pawchive.pw/data/aa/bb/${hash}.jpg`;
const one = (postId) => ({ platform: "fanbox", authorId: "123", postId,
  files: [{ key: hash, url, name: "../cover.jpg" }] });

const fake = (history = []) => {
  const data = {};
  const calls = [];
  const cancelled = [];
  const api = {
    storage: { local: { get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values) } },
    downloads: {
      search: async () => history,
      download: async (options) => { calls.push(options); const id = history.length + 1;
        history.push({ id, state: "in_progress", url: options.url, filename: `C:/Downloads/${options.filename}` });
        return id; },
      cancel: async (id) => { cancelled.push(id); },
    },
    alarms: { create: async () => {}, clear: async () => {} },
  };
  return { api, data, calls, history, cancelled };
};

test("imports retained Chrome downloads and shares one file across posts and tabs", async () => {
  const env = fake([{ id: 7, state: "complete", url: `${url}?f=old.jpg`, filename: "C:/Downloads/old.jpg" }]);
  const service = createPawchiveService(env.api);
  await Promise.all([service.submit([one("456")]), service.submit([one("789")])]);
  assert.equal(env.calls.length, 0);
  assert.equal((await service.snapshot(one("456"))).status, "complete");
  assert.equal((await service.snapshot(one("789"))).status, "complete");
  assert.equal(env.data[STORAGE_KEY].files[hash].downloadId, 7);
});

test("preview and cancellation do not start downloads", async () => {
  const env = fake();
  const service = createPawchiveService(env.api);
  assert.deepEqual(await service.preview([one("456"), one("789")]),
    { posts: 2, pending: 1, duplicate: 1, unavailable: 0 });
  assert.equal(env.calls.length, 0);
  assert.equal((await service.snapshot(one("456"))).status, "unknown");
});

test("starts once, survives worker restart, and retries only failed files", async () => {
  const env = fake();
  const service = createPawchiveService(env.api);
  await Promise.all([service.submit([one("456")]), service.submit([one("456")])]);
  assert.equal(env.calls.length, 1);
  assert.equal((await service.snapshot(one("456"))).status, "active");
  const restarted = createPawchiveService(env.api);
  await restarted.init();
  assert.equal(env.calls.length, 1);
  env.history[0].state = "interrupted";
  await restarted.changed({ id: 1, state: { current: "interrupted" } });
  assert.equal((await restarted.snapshot(one("456"))).status, "failed");
  await restarted.retry(one("456"));
  assert.equal(env.calls.length, 2);
  env.history[1].state = "complete";
  await restarted.changed({ id: 2, state: { current: "complete" } });
  assert.equal((await restarted.snapshot(one("456"))).status, "complete");
});

test("rejects untrusted file URLs without changing the queue", async () => {
  const env = fake();
  const service = createPawchiveService(env.api);
  await assert.rejects(service.submit([{ ...one("456"), files: [{ key: hash, url: "https://evil.test/data/aa/bb/" + hash }] }]), /bad-request/);
  assert.equal(env.calls.length, 0);
  assert.deepEqual(env.data[STORAGE_KEY].files, {});
});

test("author stop cancels active transfers and unavailable posts stay incomplete", async () => {
  const env = fake();
  const service = createPawchiveService(env.api);
  await service.submit([one("456"), { ...one("789"), files: [], unavailable: true }]);
  assert.equal((await service.snapshot({ platform: "fanbox", authorId: "123" })).status, "failed");
  await service.stop({ platform: "fanbox", authorId: "123" });
  assert.deepEqual(env.cancelled, [1]);
  assert.equal((await service.snapshot(one("456"))).status, "failed");
  assert.equal((await service.snapshot(one("789"))).status, "unavailable");
});
