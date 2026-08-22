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
  };

  const downloadTarget = async ({ scope, tweetId, likeArticle, likeInBackground }, root) => {
    setStatus(root, "正在下载", "loading");
    const pageMedia = await askPageMedia(tweetId);
    const response = await chrome.runtime.sendMessage({
      type: "utils.x.download",
      tweetId,
      media: [...pageMedia, ...collectDomMedia(scope)],
    });
    if (response?.ok && response.count > 0) {
      // Only like once media is actually downloading, so a failed lookup never
      // leaves a like behind. Already-liked posts expose no "like" button.
      findLikeButton(likeArticle)?.click();
      const likeResponse = likeInBackground
        ? await chrome.runtime.sendMessage({ type: "utils.x.like", tweetId })
        : null;
      const suffix = likeInBackground ? (likeResponse?.ok ? "，已点赞" : "，点赞失败") : "";
      setStatus(root, `已开始下载 ${response.count} 个文件${suffix}`, "ok");
    } else {
      setStatus(root, "没有找到可下载的媒体", "error");
    }
    window.setTimeout(() => {
      if (root.dataset.state !== "loading") {
        setStatus(root, "", "idle");
      }
    }, 2400);
  };

  const svgIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("utils-x-download__icon");
    const stem = document.createElementNS("http://www.w3.org/2000/svg", "path");
    stem.setAttribute("d", "M12 3v12");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "m7 11 5 5 5-5");
    const base = document.createElementNS("http://www.w3.org/2000/svg", "path");
    base.setAttribute("d", "M5 21h14");
    for (const path of [stem, arrow, base]) {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
    }
    return svg;
  };

  const createButton = (getTarget, label = "下载图片或视频") => {
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
        const root = createButton(
          () => ({
            scope: article,
            tweetId: tweetIdFromArticle(article),
            likeArticle: article,
          }),
          "下载图片或视频并点赞帖子",
        );
        root.setAttribute(ROOT_ATTR, "bar");
        attachDownloadButton(host, root);
      }
    }

    if (!existing.some((node) => node.getAttribute(ROOT_ATTR) === "media")) {
      const media = findMediaHost(article);
      if (media && typeof media.append === "function") {
        const root = createButton(
          () => ({
            scope: article,
            tweetId: tweetIdFromArticle(article),
            likeArticle: article,
          }),
          "下载图片或视频并点赞帖子",
        );
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
      const root = createButton(
        () => ({
          scope: link,
          tweetId: extractTweetId([link.getAttribute("href")]),
          likeInBackground: true,
        }),
        "下载图片或视频并点赞帖子",
      );
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
    const root = createButton(
      () => ({
        scope: dialog,
        tweetId: extractTweetId([window.location.pathname]),
        likeArticle: host,
      }),
      "下载图片或视频并点赞帖子",
    );
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

  const likeCurrentTweet = async (tweetId) => {
    if (!tweetStatusUrl(tweetId)) {
      return { ok: false, error: "bad-id" };
    }
    const deadline = Date.now() + 15000;
    let clicked = false;
    while (Date.now() < deadline) {
      const article = [...document.querySelectorAll("article")].find(
        (candidate) => tweetIdFromArticle(candidate) === tweetId,
      );
      if (article) {
        if (findUnlikeButton(article)) {
          return { ok: true, state: clicked ? "liked" : "already-liked" };
        }
        const button = findLikeButton(article);
        if (button && !clicked) {
          button.click();
          clicked = true;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
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
