// Classic content script (ISOLATED world). Wrapped in an IIFE because every classic
// file in one content_scripts entry shares a single global lexical scope, so a
// top-level name here would collide with x-media-core.js and kill the whole file.
(() => {
  const {
    attachDownloadButton,
    collectDomMedia,
    extractTweetId,
    findActionHost,
    findLikeButton,
    findUnlikeButton,
    findMediaDialog,
    findMediaGridLinks,
    findMediaHost,
    isMediaList,
    tweetStatusUrl,
    tweetHasVisibleMedia,
  } = globalThis.UtilsXMedia;

  const SOURCE = "utils-x-media";
  const ROOT_ATTR = "data-utils-x-download";

  const tweetIdFromArticle = (article) => {
    const hrefs = [];
    const timeLink = article.querySelector('a[href*="/status/"] time')?.closest("a");
    if (timeLink) {
      hrefs.push(timeLink.getAttribute("href"));
    }
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      if (link.closest("article") === article) {
        hrefs.push(link.getAttribute("href"));
      }
    }
    return extractTweetId(hrefs);
  };

  const askPageMedia = (tweetId) =>
    new Promise((resolve) => {
      if (!tweetId) {
        resolve([]);
        return;
      }
      const requestId = crypto.randomUUID();
      const finish = (media) => {
        window.removeEventListener("message", onMessage);
        resolve(media);
      };
      const onMessage = (event) => {
        if (event.origin !== window.location.origin) {
          return;
        }
        const data = event.data;
        if (data?.source === SOURCE && data.type === "reply" && data.requestId === requestId) {
          finish(isMediaList(data.media) ? data.media : []);
        }
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ source: SOURCE, type: "ask", requestId, tweetId }, window.location.origin);
      window.setTimeout(() => finish([]), 500);
    });

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const statusTimers = new WeakMap();
  const runIds = new WeakMap();

  const setStatus = (root, message, kind) => {
    const status = root.querySelector(".utils-x-download__status");
    const button = root.querySelector(".utils-x-download__btn");
    if (!status || !button) {
      return;
    }
    status.textContent = message;
    root.dataset.state = kind;
    button.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
    button.disabled = kind === "loading";
    window.clearTimeout(statusTimers.get(root));
    if (kind === "ok" || kind === "warn" || kind === "error") {
      statusTimers.set(root, window.setTimeout(() => setStatus(root, "", "idle"), 3600));
    }
  };

  // X flips the heart optimistically and rolls it back when the write fails, so
  // a click alone proves nothing. Already-liked posts expose no "like" button,
  // which is what keeps this from ever un-liking anything.
  const likeInPage = async (scope) => {
    if (findUnlikeButton(scope)) {
      return { ok: true, state: "already-liked" };
    }
    const button = findLikeButton(scope);
    if (!button) {
      return { ok: false, error: "no-like-button" };
    }
    button.click();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await sleep(120);
      if (findUnlikeButton(scope)) {
        return { ok: true, state: "liked" };
      }
    }
    return { ok: false, error: "like-unconfirmed" };
  };

  const likeAfterDownload = ({ tweetId, likeArticle, likeInBackground }) => {
    if (likeArticle) {
      return likeInPage(likeArticle);
    }
    if (!likeInBackground) {
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage({ type: "utils.x.like", tweetId });
  };

  const downloadTarget = async (target, root) => {
    const run = (runIds.get(root) ?? 0) + 1;
    runIds.set(root, run);
    setStatus(root, "正在下载", "loading");

    let response;
    try {
      const pageMedia = await askPageMedia(target.tweetId);
      response = await chrome.runtime.sendMessage({
        type: "utils.x.download",
        tweetId: target.tweetId,
        media: [...pageMedia, ...collectDomMedia(target.scope)],
      });
    } catch (error) {
      // Reloading the extension orphans every content script already on the
      // page, and each message then throws. That reads as a broken download
      // unless it says what actually happened.
      const stale = !chrome.runtime?.id || /context invalidated/i.test(String(error?.message ?? error));
      setStatus(root, stale ? "扩展已更新，请刷新页面" : "下载失败", "error");
      return;
    }
    if (!response?.ok || !(response.count > 0)) {
      const missing = !response?.error || response.error === "empty";
      setStatus(root, missing ? "没有找到可下载的媒体" : "下载失败", "error");
      return;
    }

    // Report the download the moment it starts. Liking can take seconds — the
    // grid route drives a background tab — so it must never hold the button in
    // its disabled loading state, and a like that fails must not be reported as
    // a failed download.
    const started = `已开始下载 ${response.count} 个文件`;
    setStatus(root, started, "ok");

    let like;
    try {
      like = await likeAfterDownload(target);
    } catch {
      like = { ok: false, error: "like-unreachable" };
    }
    if (!like || runIds.get(root) !== run) {
      return;
    }
    setStatus(root, `${started}${like.ok ? "，已点赞" : "，点赞失败"}`, like.ok ? "ok" : "warn");
  };

  // X draws its action icons as filled 24x24 paths, so a stroked outline reads as
  // foreign next to them. This is X's own share glyph with the arrow reversed.
  const ICON_PATH =
    "M12 17.41 6.29 11.7l1.42-1.41L11 13.59V4h2v9.59l3.29-3.3 1.42 1.41L12 17.41z" +
    "M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z";

  const svgIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("utils-x-download__icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATH);
    svg.append(path);
    return svg;
  };

  const BUTTON_LABEL = "下载图片或视频并点赞帖子";

  const createButton = (getTarget, label = BUTTON_LABEL) => {
    const root = document.createElement("div");
    root.className = "utils-x-download";
    root.setAttribute(ROOT_ATTR, "");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "utils-x-download__btn";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(svgIcon());

    const status = document.createElement("span");
    status.className = "utils-x-download__status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");

    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("pointerdown", stop);
    button.addEventListener("click", async (event) => {
      stop(event);
      try {
        await downloadTarget(getTarget(), root);
      } catch {
        setStatus(root, "下载失败", "error");
      }
    });

    root.append(button, status);
    return root;
  };

  const ownButtons = (article) =>
    [...article.querySelectorAll(`[${ROOT_ATTR}]`)].filter((node) => node.closest("article") === article);

  const pinMediaHost = (media) => {
    if (!media?.style || typeof getComputedStyle !== "function") {
      return;
    }
    try {
      if (getComputedStyle(media).position === "static") {
        media.style.position = "relative";
      }
    } catch {
      // Leave X layout alone if computed style is unavailable.
    }
  };

  const injectArticle = (article) => {
    const existing = ownButtons(article);
    if (!tweetHasVisibleMedia(article)) {
      for (const node of existing) {
        node.remove();
      }
      return;
    }

    if (!existing.some((node) => node.getAttribute(ROOT_ATTR) === "bar")) {
      const host = findActionHost(article);
      if (host) {
        const root = createButton(() => ({
          scope: article,
          tweetId: tweetIdFromArticle(article),
          likeArticle: article,
        }));
        root.setAttribute(ROOT_ATTR, "bar");
        attachDownloadButton(host, root);
      }
    }

    if (!existing.some((node) => node.getAttribute(ROOT_ATTR) === "media")) {
      const media = findMediaHost(article);
      if (media && typeof media.append === "function") {
        const root = createButton(() => ({
          scope: article,
          tweetId: tweetIdFromArticle(article),
          likeArticle: article,
        }));
        root.setAttribute(ROOT_ATTR, "media");
        root.classList.add("utils-x-download--overlay");
        pinMediaHost(media);
        media.append(root);
      }
    }
  };

  const injectMediaGrid = () => {
    for (const link of findMediaGridLinks(document)) {
      const host = link.parentElement;
      if (!host?.append || host.querySelector?.(`[${ROOT_ATTR}="grid"]`)) {
        continue;
      }
      const root = createButton(() => ({
        scope: link,
        tweetId: extractTweetId([link.getAttribute("href")]),
        likeInBackground: true,
      }));
      root.setAttribute(ROOT_ATTR, "grid");
      root.classList.add("utils-x-download--overlay");
      pinMediaHost(host);
      host.append(root);
    }
  };

  const injectMediaViewer = () => {
    const dialog = findMediaDialog(document);
    if (!dialog || dialog.querySelector?.(`[${ROOT_ATTR}="viewer"]`)) {
      return;
    }
    const host = findActionHost(dialog);
    if (!host) {
      return;
    }
    const root = createButton(() => ({
      scope: dialog,
      tweetId: extractTweetId([window.location.pathname]),
      likeArticle: host,
    }));
    root.setAttribute(ROOT_ATTR, "viewer");
    root.classList.add("utils-x-download--viewer");
    attachDownloadButton(host, root);
  };

  const scan = () => {
    for (const article of document.querySelectorAll("article")) {
      injectArticle(article);
    }
    injectMediaGrid();
    injectMediaViewer();
  };

  const findTweetArticle = (tweetId) =>
    [...document.querySelectorAll("article")].find((candidate) => tweetIdFromArticle(candidate) === tweetId) ?? null;

  const likeCurrentTweet = async (tweetId) => {
    if (!tweetStatusUrl(tweetId)) {
      return { ok: false, error: "bad-id" };
    }
    const deadline = Date.now() + 15000;
    let clicked = false;
    while (Date.now() < deadline) {
      const article = findTweetArticle(tweetId);
      if (article) {
        if (findUnlikeButton(article)) {
          if (!clicked) {
            return { ok: true, state: "already-liked" };
          }
          // The heart flips before X has written anything. Hold the tab open
          // long enough to see the write stick, otherwise the caller closes it
          // mid-request and the like quietly disappears.
          await sleep(1500);
          const settled = findTweetArticle(tweetId);
          return settled && !findUnlikeButton(settled)
            ? { ok: false, error: "like-reverted" }
            : { ok: true, state: "liked" };
        }
        const button = findLikeButton(article);
        if (button && !clicked) {
          button.click();
          clicked = true;
        }
      }
      await sleep(100);
    }
    return { ok: false, error: "like-timeout" };
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "utils.x.like.current") {
      return;
    }
    likeCurrentTweet(String(message.tweetId ?? ""))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window) {
      return;
    }
    const data = event.data;
    if (data?.source !== SOURCE || data.type !== "harvest" || !data.tweetId || !isMediaList(data.media)) {
      return;
    }
    chrome.runtime.sendMessage({
      type: "utils.x.cache",
      tweetId: data.tweetId,
      media: data.media,
    });
  });

  scan();
  const observer = new MutationObserver(() => {
    if (scan.queued) {
      return;
    }
    scan.queued = true;
    // Not requestAnimationFrame: a background tab never runs it, so this latch
    // would stay set forever and X would never get a button.
    window.setTimeout(() => {
      scan.queued = false;
      scan();
    }, 16);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
