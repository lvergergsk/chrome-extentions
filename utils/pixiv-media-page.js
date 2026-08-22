// Classic content script (MAIN world). Wrapped in an IIFE so nothing leaks into the
// real pixiv global scope, where a stray top-level name could break the page itself.
//
// Everything that needs the logged-in session runs here. A content script fetch is
// issued by the extension, not by the page, so it carries neither pixiv's cookies
// nor its Referer; the page context sends both without being asked.
(() => {
  const {
    BOOKMARK_ENDPOINT,
    bookmarkPayload,
    csrfToken,
    illustEndpoint,
    isBookmarked,
    isIllustId,
    isUgoira,
    originalUrls,
    pagesEndpoint,
  } = globalThis.UtilsPixivMedia;

  const SOURCE = "utils-pixiv-media";

  const post = (payload) => {
    window.postMessage({ source: SOURCE, ...payload }, window.location.origin);
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      return { error: true, message: `http-${response.status}` };
    }
    return response.json();
  };

  const resolveIllust = async (illustId) => {
    if (!isIllustId(illustId)) {
      return { ok: false, error: "bad-id" };
    }
    const detail = await fetchJson(illustEndpoint(illustId));
    if (!detail || detail.error) {
      return { ok: false, error: String(detail?.message || "detail-failed") };
    }
    const illust = detail.body;
    if (isUgoira(illust)) {
      return { ok: false, error: "ugoira" };
    }
    let pages = null;
    if (Number(illust?.pageCount) > 1) {
      const response = await fetchJson(pagesEndpoint(illustId));
      pages = response && !response.error ? response.body : null;
    }
    const urls = originalUrls(illust, pages);
    if (urls.length === 0) {
      return { ok: false, error: "empty" };
    }
    return { ok: true, urls, bookmarked: isBookmarked(illust) };
  };

  // Unlike X there is no heart to click from a grid tile, so the bookmark goes
  // straight to the API. Re-adding an existing bookmark would overwrite its tags
  // and comment, so an already-bookmarked work is short-circuited by the caller.
  const bookmarkIllust = async (illustId) => {
    if (!isIllustId(illustId)) {
      return { ok: false, error: "bad-id" };
    }
    const token = csrfToken(document);
    if (!token) {
      return { ok: false, error: "no-token" };
    }
    const response = await fetch(BOOKMARK_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify(bookmarkPayload(illustId)),
    });
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }
    const data = await response.json();
    if (data?.error) {
      return { ok: false, error: String(data.message || "rejected") };
    }
    return { ok: true, state: "bookmarked" };
  };

  const handle = (message) => {
    if (message.type === "resolve") {
      return resolveIllust(message.illustId);
    }
    if (message.type === "bookmark") {
      return bookmarkIllust(message.illustId);
    }
    return Promise.resolve({ ok: false, error: "unknown-request" });
  };

  const HANDLED = new Set(["resolve", "bookmark"]);

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE || !HANDLED.has(data.type)) {
      return;
    }
    // Always answer: the isolated side would otherwise wait for its full timeout.
    handle(data)
      .catch((error) => ({ ok: false, error: String(error?.message ?? error) }))
      .then((result) => post({ type: "reply", requestId: data.requestId, result }));
  });
})();
