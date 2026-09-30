export const WATCH_KEY = "pawchiveWatchV1";
export const WATCH_ALARM = "pawchive-watch";
const CHUNK = 20;
const keyOf = (author) => `${author.platform}/${author.authorId}`;

// The worker has no DOMParser, so page parsing happens in an offscreen document.
export const offscreenParse = (api = chrome) => {
  const parse = async (op, payload) => {
    if (!(await api.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length) {
      await api.offscreen.createDocument({ url: "pawchive-offscreen.html", reasons: ["DOM_PARSER"],
        justification: "Parse Pawchive pages for watched authors." })
        .catch((error) => { if (!/single offscreen/i.test(error?.message ?? "")) throw error; });
    }
    const response = await api.runtime.sendMessage({ type: `utils.pawchive-offscreen.${op}`, ...payload });
    if (!response?.ok) throw new Error(response?.error ?? "offscreen-unavailable");
    return response;
  };
  parse.close = () => api.offscreen.closeDocument().catch(() => {});
  return parse;
};

// A watched author gets every post not yet requested; downloads dedupe and queue through the normal service.
export function createPawchiveWatch(service, parse, api = chrome) {
  let writes = Promise.resolve(), runs = Promise.resolve();
  const read = async () => (await api.storage.local.get(WATCH_KEY))[WATCH_KEY] ?? { authors: {} };
  const mutate = (fn) => {
    const result = writes.then(async () => {
      const state = await read();
      const value = fn(state);
      await api.storage.local.set({ [WATCH_KEY]: state });
      return value;
    });
    writes = result.catch(() => {});
    return result;
  };

  const check = async (author) => {
    const { urls } = await parse("posts", { author, known: await service.requested(author) });
    // Oldest first: if the worker dies midway, the newest page still has unknown posts and the next check walks back far enough.
    const pending = urls.reverse();
    let found = 0;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const { posts } = await parse("load", { urls: pending.slice(i, i + CHUNK) });
      // Posts that failed to load stay unrequested, so the next check tries them again.
      if (posts.length) await service.submit(posts);
      found += posts.length;
    }
    return { found, failed: pending.length - found };
  };

  const run = (only) => {
    const next = runs.then(async () => {
      const { authors } = await read();
      try {
        for (const author of Object.values(authors)) {
          if (only && keyOf(only) !== keyOf(author)) continue;
          let outcome;
          try { outcome = { ...await check(author), error: null }; }
          catch (error) { outcome = { error: String(error?.message ?? error) }; }
          await mutate((state) => { if (state.authors[keyOf(author)]) Object.assign(state.authors[keyOf(author)], outcome, { checkedAt: Date.now() }); });
        }
      } finally { await parse.close?.(); }
    });
    runs = next.catch(() => {});
    return next;
  };

  const status = async (author) => ({ watch: (await read()).authors[keyOf(author)] ?? null });
  const setWatched = async (author, enabled) => {
    await mutate((state) => {
      if (!enabled) delete state.authors[keyOf(author)];
      else state.authors[keyOf(author)] ??= { platform: author.platform, authorId: author.authorId };
    });
    if (enabled) void run(author).catch(() => {});
    return status(author);
  };
  const schedule = async () => {
    if (!await api.alarms.get(WATCH_ALARM)) await api.alarms.create(WATCH_ALARM, { periodInMinutes: 24 * 60 });
  };
  return { run, status, setWatched, schedule };
}
