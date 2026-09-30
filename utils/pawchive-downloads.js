import "./pawchive-core.js";

const { filename, mediaKey, validIdentity } = globalThis.UtilsPawchive;
export const STORAGE_KEY = "pawchiveDownloadsV1";
export const ALARM = "pawchive-downloads";
export const REVISION_KEY = "pawchiveRevision";
const empty = () => ({ posts: {}, files: {}, initialized: false });
const postKey = (post) => `${post.platform}/${post.authorId}/${post.postId}`;
const running = (file) => ["active", "launching", "queued"].includes(file.status);
const itemKey = (item) => mediaKey(item.url) || mediaKey(item.finalUrl);

const validate = (posts) => {
  if (!Array.isArray(posts) || posts.length > 10000) throw new Error("bad-request");
  for (const post of posts) {
    if (!validIdentity(post) || !Array.isArray(post.files) || post.files.length > 1000) throw new Error("bad-request");
    for (const file of post.files) {
      if (!file || !file.key || mediaKey(file.url) !== file.key ||
          typeof file.name !== "string" || file.name.length > 1000) throw new Error("bad-request");
    }
  }
};

const selected = (state, scope, requestedOnly = false) => {
  if (!validIdentity(scope, false)) throw new Error("bad-request");
  return Object.entries(state.posts).filter(([key, record]) =>
    (scope.postId ? key === postKey(scope) : key.startsWith(`${scope.platform}/${scope.authorId}/`)) &&
    (!requestedOnly || record.requested));
};

const summarize = (state, records) => {
  const keys = [...new Set(records.flatMap(([, record]) => record.files))];
  const files = keys.map((key) => state.files[key] ?? { status: "missing" });
  const completed = files.filter((file) => file.status === "complete").length;
  const failed = files.filter((file) => file.status === "failed").length;
  const active = files.filter((file) => ["active", "launching"].includes(file.status)).length;
  const queued = files.filter((file) => file.status === "queued").length;
  const missing = files.filter((file) => file.status === "missing").length;
  const missingPosts = records.filter(([, record]) => record.files.some((key) =>
    !state.files[key] || state.files[key].status === "missing")).map(([key]) => key.split("/")[2]);
  const unavailablePosts = records.filter(([, record]) => record.unavailable).map(([key]) => key.split("/")[2]);
  const unavailable = unavailablePosts.length;
  const lowres = records.filter(([, record]) => record.lowres).length;
  const stopped = records.length > 0 && records.every(([, record]) => record.stopped);
  const status = !records.length ? "unknown" : completed === files.length && files.length && !unavailable ? "complete" :
    stopped ? "stopped" : active ? "active" : queued ? "queued" : failed ? "failed" :
    unavailable ? "unavailable" : "missing";
  return { status, total: files.length, completed, failed, active, queued, missing, missingPosts, unavailable, unavailablePosts, lowres,
    unavailableReason: records.length === 1 ? records[0][1].unavailableReason : null };
};

// Metadata observation never queues downloads. Destination belongs to the first submission.
const catalog = (state, posts) => {
  for (const post of posts) {
    const key = postKey(post);
    const previous = state.posts[key];
    const keys = [...new Set(post.files.map((file) => file.key))];
    for (const file of post.files) {
      state.files[file.key] ??= { status: "missing" };
      const parsed = new URL(file.url);
      state.files[file.key].url = parsed.origin + parsed.pathname;
    }
    state.posts[key] = { ...previous,
      files: post.unavailable && !keys.length && previous ? previous.files : keys,
      unavailable: !!post.unavailable || !keys.length,
      lowres: !!post.lowres,
      unavailableReason: ["unarchived", "unsupported", "fetch-failed"].includes(post.unavailableReason) ? post.unavailableReason : !keys.length ? "unarchived" : null };
  }
};

// Pages listen to this tiny session key, not the ledger: a local-storage listener is sent the whole ledger, twice, on every write.
export const touch = (api) => api.storage.session?.set({ [REVISION_KEY]: Date.now() });

const settle = (file, item) => {
  if (file.status === "complete") return;
  file.downloadId = item.id;
  file.status = item.state === "complete" ? "complete" : item.state === "interrupted" ? "failed" : "active";
  if (item.state === "interrupted") file.error = item.error ?? "interrupted";
  else delete file.error;
};

export function createPawchiveService(api = chrome) {
  // ponytail: one serialized ledger; split by author only if storage throughput becomes a limit.
  let serial = Promise.resolve();
  let pumping = false, rerun = false, ready;
  const lookup = async () => (await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? empty();
  const mutate = (fn) => {
    const result = serial.then(async () => {
      const state = await lookup();
      const value = await fn(state);
      await api.storage.local.set({ [STORAGE_KEY]: state });
      await touch(api);
      return value;
    });
    serial = result.catch(() => {});
    return result;
  };
  const wake = () => api.alarms.create(ALARM, { periodInMinutes: 1 });
  const syncAlarm = (state) => Object.values(state.files).some(running) ? wake() : api.alarms.clear(ALARM);

  const reconcile = () => mutate(async (state) => {
    if (pumping) return;
    // Chrome defaults to only 1,000 entries. The oldest completed copy owns the hash.
    const history = await api.downloads.search({ limit: 0, orderBy: ["startTime"] });
    for (const item of history) {
      if (item.state !== "complete") continue;
      const key = itemKey(item);
      if (key && state.files[key]?.status !== "complete") {
        const file = state.files[key] ??= {};
        settle(file, item);
      }
    }
    state.initialized = true;
    for (const [key, file] of Object.entries(state.files)) {
      if (!["active", "launching"].includes(file.status)) continue;
      let item = history.find((entry) => entry.id === file.downloadId);
      if (!item && file.status === "launching") {
        const directory = file.filename.slice(0, file.filename.lastIndexOf("/") + 1);
        item = history.find((entry) => itemKey(entry) === key &&
          entry.filename?.replace(/\\/g, "/").includes(`/${directory}`) &&
          Date.parse(entry.startTime ?? "") >= file.startedAt - 5000);
      }
      if (item) settle(file, item);
      else {
        // The worker can die on either side of downloads.download(). Never replay an uncertain launch.
        file.status = "failed";
        file.error = "recovery-unknown";
        delete file.downloadId;
      }
    }
    await syncAlarm(state);
  });

  const init = () => ready ??= reconcile().then(() => pump()).catch((error) => { ready = undefined; throw error; });
  const snapshot = async (scope) => {
    await init();
    await serial;
    const state = await lookup();
    const records = selected(state, scope);
    return { ...summarize(state, scope.postId ? records : records.filter(([, record]) => record.requested)),
      requested: records.some(([, record]) => record.requested),
      postStates: Object.fromEntries(records.map(([key, record]) => [key.split("/")[2], summarize(state, [[key, record]])])) };
  };

  const inspect = async (posts) => {
    validate(posts);
    await init();
    return mutate((state) => {
      catalog(state, posts);
      return { postStates: Object.fromEntries(posts.map((post) =>
        [post.postId, summarize(state, [[postKey(post), state.posts[postKey(post)]]])])) };
    });
  };

  const preview = async (posts) => {
    validate(posts);
    await init();
    await serial;
    const state = await lookup(), seen = new Set();
    let duplicate = 0, pending = 0, unavailable = 0;
    for (const post of posts) {
      if (post.unavailable || !post.files.length) unavailable++;
      for (const file of post.files) {
        const known = state.files[file.key];
        if (seen.has(file.key) || known && (known.status === "complete" || running(known))) duplicate++;
        else pending++;
        seen.add(file.key);
      }
    }
    return { posts: posts.length, pending, duplicate, unavailable };
  };

  const pump = async () => {
    if (pumping) { rerun = true; return; }
    pumping = true;
    try {
      do {
        rerun = false;
        while (true) {
          const next = await mutate((state) => {
            if (Object.values(state.files).filter((file) => ["active", "launching"].includes(file.status)).length >= 3) return null;
            const entry = Object.entries(state.files).find(([, file]) => file.status === "queued");
            if (!entry) return null;
            const [key, file] = entry;
            file.status = "launching";
            file.startedAt = Date.now();
            delete file.downloadId;
            delete file.error;
            return { key, url: file.url, filename: file.filename };
          });
          if (!next) break;
          let downloadId;
          try {
            downloadId = await api.downloads.download({ url: next.url, filename: next.filename,
              conflictAction: "uniquify", saveAs: false });
          } catch (error) {
            await mutate((state) => {
              const file = state.files[next.key];
              if (file.status === "launching") { file.status = "failed"; file.error = String(error?.message ?? error); }
            });
            continue;
          }
          // A storage failure here must leave the launching intent intact for reconciliation.
          const stopped = await mutate((state) => {
            const file = state.files[next.key];
            if (file.status === "launching") { file.status = "active"; file.downloadId = downloadId; }
            return file.status === "failed" && file.error === "stopped";
          });
          if (stopped) await api.downloads.cancel(downloadId).catch(() => {});
          else {
            // Tiny files can finish before their ID is persisted and before onChanged sees the record.
            const [item] = await api.downloads.search({ id: downloadId });
            if (item) await mutate((state) => {
              const file = state.files[next.key];
              if (file.downloadId === downloadId && file.status !== "failed") settle(file, item);
            });
          }
        }
        await mutate(syncAlarm);
      } while (rerun);
    } finally { pumping = false; }
  };

  const submit = async (posts) => {
    validate(posts);
    await init();
    const result = await mutate(async (state) => {
      // Arm recovery before making any queued work durable.
      await wake();
      catalog(state, posts);
      let queued = 0, duplicate = 0;
      for (const post of posts) {
        const record = state.posts[postKey(post)];
        record.requested = true;
        record.stopped = false;
        for (const source of post.files) {
          const file = state.files[source.key];
          if (["missing", "failed"].includes(file.status)) {
            file.status = "queued";
            file.filename ??= filename(post, source);
            queued++;
          } else duplicate++;
        }
      }
      return { queued, duplicate };
    });
    await pump();
    return result;
  };

  const retry = async (scope) => {
    await init();
    await mutate(async (state) => {
      const records = selected(state, scope, true);
      await wake();
      for (const [, record] of records) {
        record.stopped = false;
        for (const key of record.files) if (state.files[key]?.status === "failed") state.files[key].status = "queued";
      }
    });
    await pump();
    return snapshot(scope);
  };

  const stop = async (scope) => {
    await init();
    const ids = await mutate((state) => {
      const records = selected(state, scope, true);
      records.forEach(([, record]) => { record.stopped = true; });
      const wanted = new Set(Object.values(state.posts).filter((record) => record.requested && !record.stopped).flatMap((record) => record.files));
      const cancel = [];
      for (const key of new Set(records.flatMap(([, record]) => record.files))) {
        const file = state.files[key];
        if (file && running(file) && !wanted.has(key)) {
          if (file.downloadId != null) cancel.push(file.downloadId);
          file.status = "failed";
          file.error = "stopped";
        }
      }
      return cancel;
    });
    await Promise.all(ids.map((id) => api.downloads.cancel(id).catch(() => {})));
    await pump();
    return snapshot(scope);
  };

  const changed = async (delta) => {
    if (!["complete", "interrupted"].includes(delta.state?.current)) return;
    await init();
    const [item] = await api.downloads.search({ id: delta.id });
    if (item && !itemKey(item)) return;
    await mutate((state) => {
      let file = Object.values(state.files).find((entry) => entry.downloadId === delta.id);
      // Keep later Pawchive downloads made through Chrome as well as our own queue.
      if (!file && item?.state === "complete") {
        const key = itemKey(item);
        if (key) file = state.files[key] ??= {};
      }
      if (!file || file.status === "complete") return;
      settle(file, item ?? { id: delta.id, state: delta.state.current, error: delta.error?.current });
    });
    await pump();
  };
  const requested = async (author) => {
    await init();
    await serial;
    // Only posts with every original count; unloaded, unarchived and thumbnail-only posts are checked again.
    // ponytail: those posts are refetched on every watch check; keep a per-post check time if that gets slow.
    return selected(await lookup(), author, true).filter(([, record]) => !record.unavailable && !record.lowres)
      .map(([key]) => key.split("/")[2]);
  };
  return { init, snapshot, inspect, preview, submit, retry, stop, changed, reconcile, pump, requested };
}
