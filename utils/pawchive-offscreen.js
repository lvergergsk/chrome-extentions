(() => {
  const { authorPosts, loadPosts, parsePageUrl } = globalThis.UtilsPawchive;
  const load = async (url) => {
    if (!parsePageUrl(url)) throw new Error("bad-url");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("page-unavailable");
    return new DOMParser().parseFromString(await response.text(), "text/html");
  };
  // Every page or post pings the worker, which keeps it awake while this document fetches.
  const progress = () => chrome.runtime.sendMessage({ type: "utils.pawchive-offscreen.progress" }).catch(() => {});

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const actions = {
      "utils.pawchive-offscreen.posts": async () =>
        ({ urls: await authorPosts(message.author, load, { progress, known: new Set(message.known) }) }),
      "utils.pawchive-offscreen.load": () => loadPosts(message.urls.filter((url) => parsePageUrl(url)?.postId), load, { progress }),
    };
    if (!actions[message?.type]) return;
    Promise.resolve().then(actions[message.type]).then((result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  });
})();
