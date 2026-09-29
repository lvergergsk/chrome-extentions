import "./pawchive-core.js";

const { filename, mediaKey, parsePageUrl } = globalThis.UtilsPawchive;
export const STORAGE_KEY = "pawchiveDownloadsV1";
export const ALARM = "pawchive-downloads";
const empty = () => ({ posts: {}, files: {}, initialized: false });
const postKey = (post) => `${post.platform}/${post.authorId}/${post.postId}`;

export function createPawchiveService(api = chrome) {
  let serial = Promise.resolve();
  let pumping = false;
  let ready;
  const mutate = (fn) => {
    const result = serial.then(async () => {
      const state = (await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? empty();
      const value = await fn(state);
      await api.storage.local.set({ [STORAGE_KEY]: state });
      return value;
    });
    serial = result.catch(() => {});
    return result;
  };

  const lookup = async () => (await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? empty();
  const allDownloads = async () => api.downloads.search({});
  const itemKey = (item) => mediaKey(item.url) || mediaKey(item.finalUrl);

  const reconcile = () => mutate(async (state) => {
    const history = await allDownloads();
    if (!state.initialized) {
      for (const item of history) {
        if (item.state !== "complete") continue;
        const key = itemKey(item);
        if (key && !state.files[key]) state.files[key] = { status: "complete", downloadId: item.id };
      }
      state.initialized = true;
    }
    for (const [key, file] of Object.entries(state.files)) {
      if (file.status === "complete") continue;
      let item = file.downloadId == null ? null : history.find((entry) => entry.id === file.downloadId);
      if (!item && file.status === "launching") {
        item = history.find((entry) => itemKey(entry) === key &&
          entry.filename?.replace(/\\/g, "/").endsWith(file.filename) &&
          Date.parse(entry.startTime ?? "") >= (file.startedAt ?? 0) - 30000);
      }
      if (item) {
        file.downloadId = item.id;
        file.status = item.state === "complete" ? "complete" : item.state === "interrupted" ? "failed" : "active";
      } else if (file.status === "active" || file.status === "launching") {
        file.status = "queued";
        file.downloadId = null;
      }
    }
  });

  const init = () => ready ??= reconcile().then(() => pump());
  const snapshot = async (post) => {
    await init();
    const state = await lookup();
    const records = post.postId ? [state.posts[postKey(post)]].filter(Boolean) :
      Object.entries(state.posts).filter(([key]) => key.startsWith(`${post.platform}/${post.authorId}/`)).map(([, value]) => value);
    if (!records.length) return { status: "unknown", total: 0, completed: 0, failed: 0 };
    const files = [...new Set(records.flatMap((record) => record.files))].map((id) => state.files[id]).filter(Boolean);
    const completed = files.filter((file) => file.status === "complete").length;
    const failed = files.filter((file) => file.status === "failed").length;
    const unavailable = records.filter((record) => record.unavailable).length;
    const status = unavailable && !files.length ? "unavailable" : !files.length ? "unavailable" :
      completed === files.length && !unavailable ? "complete" : failed || unavailable ? "failed" :
      files.some((file) => file.status === "active" || file.status === "launching") ? "active" : "queued";
    return { status, total: files.length, completed, failed, unavailable };
  };

  const preview = async (posts) => {
    await init();
    if (!Array.isArray(posts) || posts.length > 10000) throw new Error("bad-request");
    const state = await lookup();
    const seen = new Set();
    let duplicate = 0, pending = 0, unavailable = 0;
    for (const post of posts) {
      const id = parsePageUrl(`https://pawchive.pw/${post.platform}/user/${post.authorId}/post/${post.postId}`);
      if (!id?.postId || !Array.isArray(post.files) || post.files.length > 1000) throw new Error("bad-request");
      if (post.unavailable || !post.files.length) unavailable++;
      for (const file of post.files) {
        if (mediaKey(file.url) !== file.key) throw new Error("bad-request");
        if (seen.has(file.key) || state.files[file.key]?.status === "complete" ||
            state.files[file.key]?.status === "active" || state.files[file.key]?.status === "queued") duplicate++;
        else { seen.add(file.key); pending++; }
      }
    }
    return { posts: posts.length, pending, duplicate, unavailable };
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (true) {
        const next = await mutate((state) => {
          const active = Object.values(state.files).filter((file) => file.status === "active" || file.status === "launching").length;
          if (active >= 3) return null;
          const entry = Object.entries(state.files).find(([, file]) => file.status === "queued");
          if (!entry) return null;
          const [key, file] = entry;
          file.status = "launching";
          file.startedAt = Date.now();
          return { key, url: file.url, filename: file.filename };
        });
        if (!next) break;
        try {
          const downloadId = await api.downloads.download({ url: next.url, filename: next.filename,
            conflictAction: "uniquify", saveAs: false });
          const stopped = await mutate((state) => {
            const file = state.files[next.key];
            if (file?.status === "launching") { file.status = "active"; file.downloadId = downloadId; }
            return file?.status === "failed" && file.error === "stopped";
          });
          if (stopped) await api.downloads.cancel(downloadId).catch(() => {});
        } catch (error) {
          await mutate((state) => {
            const file = state.files[next.key];
            if (file) { file.status = "failed"; file.error = String(error?.message ?? error); }
          });
        }
      }
    } finally { pumping = false; }
    const state = await lookup();
    if (Object.values(state.files).some((file) => file.status === "active" || file.status === "launching" || file.status === "queued")) {
      await api.alarms.create(ALARM, { delayInMinutes: 1 });
    } else {
      await api.alarms.clear(ALARM);
    }
  };

  const submit = async (posts) => {
    await init();
    if (!Array.isArray(posts) || posts.length > 10000) throw new Error("bad-request");
    const results = await mutate((state) => {
      let queued = 0, duplicate = 0;
      for (const post of posts) {
        const id = parsePageUrl(`https://pawchive.pw/${post.platform}/user/${post.authorId}/post/${post.postId}`);
        if (!id?.postId || !Array.isArray(post.files) || post.files.length > 1000) throw new Error("bad-request");
        const key = postKey(id);
        const keys = [];
        for (const file of post.files) {
          if (mediaKey(file.url) !== file.key) throw new Error("bad-request");
          if (keys.includes(file.key)) continue;
          keys.push(file.key);
          if (state.files[file.key]) {
            if (state.files[file.key].status === "failed") { state.files[file.key].status = "queued"; queued++; }
            else duplicate++;
            continue;
          }
          state.files[file.key] = { status: "queued", url: file.url, filename: filename(id, file) };
          queued++;
        }
        state.posts[key] = { files: keys, unavailable: !!post.unavailable };
      }
      return { queued, duplicate };
    });
    await pump();
    return results;
  };

  const retry = async (post) => {
    await init();
    await mutate((state) => {
      const records = post.postId ? [state.posts[postKey(post)]].filter(Boolean) :
        Object.entries(state.posts).filter(([key]) => key.startsWith(`${post.platform}/${post.authorId}/`)).map(([, value]) => value);
      for (const record of records) for (const key of record.files)
        if (state.files[key]?.status === "failed") state.files[key].status = "queued";
    });
    await pump();
    return snapshot(post);
  };

  const stop = async (post) => {
    await init();
    const cancel = await mutate((state) => {
      const keys = post.postId ? [postKey(post)] : Object.keys(state.posts).filter((key) => key.startsWith(`${post.platform}/${post.authorId}/`));
      const selected = new Set(keys.flatMap((key) => state.posts[key]?.files ?? []));
      const elsewhere = new Set(Object.entries(state.posts).filter(([key]) => !keys.includes(key)).flatMap(([, value]) => value.files));
      const ids = [];
      for (const key of selected) {
        if (elsewhere.has(key)) continue;
        const file = state.files[key];
        if (file?.status === "queued" || file?.status === "launching" || file?.status === "active") {
          if (file.downloadId != null) ids.push(file.downloadId);
          file.status = "failed";
          file.error = "stopped";
        }
      }
      return ids;
    });
    await Promise.all(cancel.map((id) => api.downloads.cancel(id).catch(() => {})));
    return snapshot(post);
  };

  const changed = async (delta) => {
    if (!delta.state?.current) return;
    await init();
    await mutate((state) => {
      const file = Object.values(state.files).find((entry) => entry.downloadId === delta.id);
      if (!file) return;
      if (delta.state.current === "complete") file.status = "complete";
      if (delta.state.current === "interrupted") { file.status = "failed"; file.error = delta.error?.current ?? "interrupted"; }
    });
    await pump();
  };
  return { init, snapshot, preview, submit, retry, stop, changed, reconcile, pump };
}
