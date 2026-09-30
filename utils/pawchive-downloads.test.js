import test from "node:test";
import assert from "node:assert/strict";
import { createPawchiveService, STORAGE_KEY, ALARM } from "./pawchive-downloads.js";

const author = { platform: "fanbox", authorId: "123" };
const media = (n = 0) => {
  const key = "aabb" + n.toString(16).padStart(60, "c");
  return { key, url: `https://file.pawchive.pw/data/aa/bb/${key}.jpg`, name: "../cover.jpg" };
};
const one = (postId = "456", files = [media()]) => ({ ...author, postId, files });
const hash = media().key;

const fake = (history = []) => {
  const data = {}, calls = [], cancelled = [], searches = [], alarms = new Map(), hooks = {};
  let nextId = Math.max(0, ...history.map((item) => item.id)) + 1;
  const api = {
    storage: { local: {
      get: async (key) => structuredClone({ [key]: data[key] }),
      set: async (values) => { await hooks.set?.(values); Object.assign(data, structuredClone(values)); },
    } },
    downloads: {
      search: async (query) => {
        searches.push(query);
        await hooks.search?.(query);
        return structuredClone(history.filter((item) => query.id == null || item.id === query.id)
          .sort((a, b) => Date.parse(a.startTime ?? 0) - Date.parse(b.startTime ?? 0))
          .slice(0, query.limit === 0 ? undefined : query.limit ?? 1000));
      },
      download: async (options) => {
        assert.ok(alarms.has(ALARM), "recovery alarm must exist before download starts");
        calls.push(options);
        await hooks.download?.(options);
        const id = nextId++;
        history.push({ id, state: hooks.instant ? "complete" : "in_progress", url: options.url,
          filename: `C:/Downloads/${options.filename}`, startTime: new Date().toISOString() });
        return id;
      },
      cancel: async (id) => { cancelled.push(id); history.find((item) => item.id === id).state = "interrupted"; },
    },
    alarms: { create: async (name, options) => { alarms.set(name, options); }, clear: async (name) => { alarms.delete(name); } },
  };
  const complete = async (service, id, state = "complete") => {
    history.find((item) => item.id === id).state = state;
    await service.changed({ id, state: { current: state } });
  };
  return { api, data, calls, history, cancelled, alarms, hooks, searches, complete };
};

test("imports all retained Chrome history, chooses first copy, and survives erased history", async () => {
  const history = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, state: "complete", url: "https://other.test/file" }));
  history.push({ id: 1002, state: "complete", url: media().url + "?f=old.jpg", startTime: "2026-01-01" },
    { id: 1003, state: "complete", url: media().url + "?f=new.jpg", startTime: "2026-02-01" });
  const env = fake(history), service = createPawchiveService(env.api);
  await service.inspect([one()]);
  assert.equal((await service.snapshot(one())).status, "complete");
  await Promise.all([service.submit([one()]), service.submit([one("789")])]);
  assert.equal(env.calls.length, 0);
  assert.equal(env.data[STORAGE_KEY].files[hash].downloadId, 1002);
  assert.equal(env.searches[0].limit, 0);
  env.history.length = 0;
  const restarted = createPawchiveService(env.api);
  assert.equal((await restarted.snapshot(one("789"))).status, "complete");
});

test("observation and preview start no downloads and first submission chooses the destination", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.inspect([one()]);
  assert.equal((await service.snapshot(one())).status, "missing");
  assert.equal((await service.snapshot(one())).requested, false);
  assert.equal((await service.snapshot(author)).status, "unknown");
  assert.deepEqual(await service.preview([one(), one("789")]), { posts: 2, pending: 1, duplicate: 1, unavailable: 0 });
  assert.equal(env.calls.length, 0); // A cancelled confirmation stops here.
  await service.submit([one("789")]);
  assert.equal((await service.snapshot(one("789"))).requested, true);
  assert.ok(env.calls[0].filename.includes("/789/"));
});

test("simultaneous clicks across posts/tabs produce only one download", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await Promise.all(Array.from({ length: 12 }, (_, i) => service.submit([one(String(456 + i % 3))])));
  assert.equal(env.calls.length, 1);
  await env.complete(service, 1);
  for (const id of ["456", "457", "458"]) assert.equal((await service.snapshot(one(id))).status, "complete");
  assert.equal(env.alarms.size, 0);
});

test("queue stays at three downloads and advances without a content script", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.submit([one("456", [0, 1, 2, 3, 4].map(media))]);
  assert.equal(env.calls.length, 3);
  assert.equal((await service.snapshot(one())).queued, 2);
  await env.complete(service, 1);
  assert.equal(env.calls.length, 4);
  await env.complete(service, 2);
  assert.equal(env.calls.length, 5);
  for (const id of [3, 4, 5]) await env.complete(service, id);
  assert.equal((await service.snapshot(one())).status, "complete");
});

test("partial retry downloads only failures, and a retry launch never reuses the old ID", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.submit([one("456", [media(), media(1)])]);
  await env.complete(service, 1);
  await env.complete(service, 2, "interrupted");
  assert.equal((await service.snapshot(one())).status, "failed");
  env.hooks.download = async () => {
    const retry = env.data[STORAGE_KEY].files[media(1).key];
    assert.equal(retry.downloadId, undefined);
  };
  await service.retry(one());
  assert.equal(env.calls.length, 3);
  assert.equal(env.calls[2].url, media(1).url);
  await env.complete(service, 3);
  assert.equal((await service.snapshot(one())).completed, 2);
});

test("restart reconciles active IDs and starts only durable queued items", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.submit([one("456", [0, 1, 2, 3].map(media))]);
  env.history[0].state = "complete"; // Event missed while the worker was terminated.
  const restarted = createPawchiveService(env.api);
  await restarted.init();
  assert.equal(env.calls.length, 4);
  assert.equal((await restarted.snapshot(one())).active, 3);
  assert.equal((await restarted.snapshot(one())).completed, 1);
});

test("lost ID persistence is recovered by the original hash/path without another submission", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  env.hooks.set = async (values) => {
    if (values[STORAGE_KEY].files[hash]?.status === "active") throw new Error("storage unavailable");
  };
  await assert.rejects(service.submit([one()]), /storage unavailable/);
  assert.equal(env.calls.length, 1);
  assert.equal(env.data[STORAGE_KEY].files[hash].status, "launching");
  assert.ok(env.alarms.has(ALARM));
  // Chrome may add a suffix because an older, erased-history copy remains on disk.
  env.history[0].filename = env.history[0].filename.replace(".jpg", " (1).jpg");
  env.hooks.set = null;
  const restarted = createPawchiveService(env.api);
  await restarted.init();
  assert.equal(env.calls.length, 1);
  assert.equal((await restarted.snapshot(one())).status, "active");
});

test("uncertain launch or deleted active history is not automatically replayed", async () => {
  for (const status of ["launching", "active"]) {
    const env = fake();
    env.data[STORAGE_KEY] = { posts: { "fanbox/123/456": { files: [hash], requested: true } },
      files: { [hash]: { status, url: media().url, filename: "utils-pawchive/fanbox/123/456/cover.jpg", startedAt: Date.now(), downloadId: 99 } } };
    const service = createPawchiveService(env.api);
    assert.equal((await service.snapshot(one())).status, "failed");
    assert.equal(env.calls.length, 0);
    assert.equal(env.data[STORAGE_KEY].files[hash].error, "recovery-unknown");
  }
});

test("instant completion and later Chrome downloads become persistent completed records", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  env.hooks.instant = true;
  await service.submit([one()]);
  assert.equal((await service.snapshot(one())).status, "complete");
  env.history.push({ id: 90, state: "complete", url: media(1).url });
  await service.changed({ id: 90, state: { current: "complete" } });
  await service.inspect([one("789", [media(1)])]);
  assert.equal((await service.snapshot(one("789"))).status, "complete");
});

test("an initial history read error is recoverable", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  env.hooks.search = async () => { throw new Error("offline"); };
  await assert.rejects(service.init(), /offline/);
  env.hooks.search = null;
  await service.init();
});

test("invalid batch is rejected atomically including missing identifiers and URLs", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.init();
  for (const bad of [{ ...one(), authorId: undefined }, { ...one(), postId: "../bad" },
    one("789", [{ ...media(), url: "https://evil.test/" }]), one("789", [{ ...media(), key: null }])]) {
    await assert.rejects(service.submit([one(), bad]), /bad-request/);
  }
  assert.equal(env.calls.length, 0);
  assert.deepEqual(env.data[STORAGE_KEY].files, {});
});

const thumb = (n = 0) => {
  const hash = media(n).key;
  return { key: `thumb-${hash}`, url: `https://img.pawchive.pw/thumbnail/data/aa/bb/${hash}.jpg`, name: "lowres.jpg" };
};

test("only posts with every original count as requested; unloaded, unarchived and thumbnail posts are checked again", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.submit([one("1"), { ...one("2", []), unavailable: true, unavailableReason: "fetch-failed" }, one("3", []),
    { ...one("4", [thumb(4)]), lowres: true }]);
  assert.deepEqual(await service.requested(author), ["1"]);
  assert.equal((await service.snapshot(one("4"))).lowres, 1);
});

test("a thumbnail download does not block the original with the same hash", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  env.hooks.instant = true;
  await service.submit([{ ...one("5", [thumb(5)]), lowres: true }]);
  await service.submit([one("5", [media(5)])]);
  assert.deepEqual(env.calls.map((call) => call.url), [thumb(5).url, media(5).url]);
  assert.match(env.calls[0].filename, /lowres-thumb-aabb/);
  const state = await service.snapshot(one("5"));
  assert.equal(state.status, "complete");
  assert.equal(state.lowres, 0);
});

test("stop preserves other posts sharing the file; author stop cancels the last reference", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.submit([one(), one("789")]);
  await service.stop(one());
  assert.deepEqual(env.cancelled, []);
  assert.equal((await service.snapshot(one())).status, "stopped");
  await service.stop(author);
  assert.deepEqual(env.cancelled, [1]);
  await service.retry(author);
  assert.equal(env.calls.length, 2);
});

test("unarchived and partly identified posts never become complete; missing ledger is not success", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  env.hooks.instant = true;
  await service.submit([one(), { ...one("789", []), unavailable: true }, { ...one("101", [media(1)]), unavailable: true }]);
  assert.equal((await service.snapshot(one())).status, "complete");
  assert.equal((await service.snapshot(one("789"))).status, "unavailable");
  assert.equal((await service.snapshot(one("101"))).status, "unavailable");
  assert.equal((await service.snapshot(author)).unavailable, 2);
  delete env.data[STORAGE_KEY].files[hash];
  assert.equal((await service.snapshot(one())).status, "missing");
});

test("stop and alarm reconciliation during an in-flight launch do not orphan or duplicate it", async () => {
  const env = fake(), service = createPawchiveService(env.api);
  await service.init();
  let release, launched;
  const started = new Promise((resolve) => { launched = resolve; });
  env.hooks.download = () => new Promise((resolve) => { release = resolve; launched(); });
  const submission = service.submit([one()]);
  await started;
  await service.reconcile();
  assert.equal(env.data[STORAGE_KEY].files[hash].status, "launching");
  await service.stop(one());
  release();
  await submission;
  assert.deepEqual(env.cancelled, [1]);
  assert.equal(env.calls.length, 1);
  assert.equal((await service.snapshot(one())).status, "stopped");
});

test("every ledger write bumps the small session revision that pages listen to", async () => {
  const env = fake(), service = createPawchiveService(env.api), ticks = [];
  env.api.storage.session = { set: async (values) => ticks.push(values.pawchiveRevision) };
  await service.inspect([one()]);
  assert.ok(ticks.length > 0 && ticks.every(Number.isFinite));
});
