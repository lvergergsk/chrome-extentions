// Classic content script (ISOLATED world). Wrapped in an IIFE because every classic
// file in one content_scripts entry shares a single global lexical scope, so a
// top-level name here would collide with pixiv-media-core.js and kill the whole file.
(() => {
  const { domOriginalUrls, illustIdFrom, isIllustId, mainIllustHosts, thumbnailHost, thumbnailLinks } =
    globalThis.UtilsPixivMedia;

  const SOURCE = "utils-pixiv-media";
  const ROOT_ATTR = "data-utils-pixiv-download";
  // /ajax/illust can take a while on a cold cache, and a grid click that timed out
  // early would silently fall back to the DOM and download nothing.
  const PAGE_TIMEOUT_MS = 10000;

  const askPage = (type, illustId) =>
    new Promise((resolve) => {
      if (!isIllustId(illustId)) {
        resolve({ ok: false, error: "bad-id" });
        return;
      }
      const requestId = crypto.randomUUID();
      const finish = (result) => {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
        resolve(result);
      };
      const onMessage = (event) => {
        if (event.origin !== window.location.origin || event.source !== window) {
          return;
        }
        const data = event.data;
        if (data?.source === SOURCE && data.type === "reply" && data.requestId === requestId) {
          finish(data.result ?? { ok: false, error: "no-result" });
        }
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ source: SOURCE, type, requestId, illustId }, window.location.origin);
      const timer = window.setTimeout(() => finish({ ok: false, error: "timeout" }), PAGE_TIMEOUT_MS);
    });

  const statusTimers = new WeakMap();
  const runIds = new WeakMap();

  const setStatus = (root, message, kind) => {
    const status = root.querySelector(".utils-pixiv-download__status");
    const button = root.querySelector(".utils-pixiv-download__btn");
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

  const bookmarkLabel = (bookmark) => {
    if (!bookmark?.ok) {
      return "，收藏失败";
    }
    return bookmark.state === "already-bookmarked" ? "，已经收藏过" : "，已收藏";
  };

  const downloadIllust = async (illustId, root) => {
    const run = (runIds.get(root) ?? 0) + 1;
    runIds.set(root, run);
    setStatus(root, "正在下载", "loading");

    const resolved = await askPage("resolve", illustId);
    if (!resolved.ok && resolved.error === "ugoira") {
      setStatus(root, "うごイラ（动图）暂不支持", "warn");
      return;
    }
    // The full-size links on an artwork page are originals too, so a failed ajax
    // call still gets the visible pages out instead of reporting nothing at all.
    const urls = resolved.ok ? resolved.urls : domOriginalUrls(document);
    if (urls.length === 0) {
      setStatus(root, "没有找到可下载的图片", "error");
      return;
    }

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: "utils.pixiv.download", illustId, urls });
    } catch (error) {
      // Reloading the extension orphans every content script already on the page,
      // and each message then throws. That reads as a broken download unless it
      // says what actually happened.
      const stale = !chrome.runtime?.id || /context invalidated/i.test(String(error?.message ?? error));
      setStatus(root, stale ? "扩展已更新，请刷新页面" : "下载失败", "error");
      return;
    }
    if (!response?.ok || !(response.count > 0)) {
      setStatus(root, response?.error === "empty" ? "没有找到可下载的图片" : "下载失败", "error");
      return;
    }

    // Report the download the moment it starts. The bookmark is a second round trip
    // through the page and must never hold the button in its disabled loading
    // state, nor turn a finished download into a reported failure.
    const started = `已开始下载 ${response.count} 张`;
    setStatus(root, started, "ok");

    // Re-adding an existing bookmark would wipe the tags and comment already on it.
    const bookmark = resolved.bookmarked
      ? { ok: true, state: "already-bookmarked" }
      : await askPage("bookmark", illustId);
    if (runIds.get(root) !== run) {
      return;
    }
    setStatus(root, `${started}${bookmarkLabel(bookmark)}`, bookmark.ok ? "ok" : "warn");
  };

  // Same glyph as the X button so the two surfaces read as one feature: a filled
  // 24x24 download arrow over a tray.
  const ICON_PATH =
    "M12 17.41 6.29 11.7l1.42-1.41L11 13.59V4h2v9.59l3.29-3.3 1.42 1.41L12 17.41z" +
    "M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z";

  const svgIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("utils-pixiv-download__icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATH);
    svg.append(path);
    return svg;
  };

  const BUTTON_LABEL = "下载原图并收藏作品";

  const createButton = (illustId) => {
    const root = document.createElement("div");
    root.className = "utils-pixiv-download";
    root.setAttribute(ROOT_ATTR, "");
    root.dataset.illust = illustId;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "utils-pixiv-download__btn";
    button.setAttribute("aria-label", BUTTON_LABEL);
    button.title = BUTTON_LABEL;
    button.append(svgIcon());

    const status = document.createElement("span");
    status.className = "utils-pixiv-download__status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");

    // Every host is a link or sits inside one, so an unswallowed click navigates
    // away mid-download.
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("pointerdown", stop);
    button.addEventListener("click", async (event) => {
      stop(event);
      try {
        await downloadIllust(illustId, root);
      } catch {
        setStatus(root, "下载失败", "error");
      }
    });

    root.append(button, status);
    return root;
  };

  const pinHost = (host) => {
    if (!host?.style || typeof getComputedStyle !== "function") {
      return;
    }
    try {
      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }
    } catch {
      // Leave pixiv layout alone if computed style is unavailable.
    }
  };

  const MAIN_INSET = 12;

  // The full-size link is a flex box as wide as the column, not as wide as the
  // illustration, so a plain top/right overlay floats out in the grey margin next
  // to the artwork. Pin the button to the image's own box and keep it there when
  // the layout reflows.
  const pinToImage = (root, host) => {
    const image = host.querySelector?.("img");
    if (!image || typeof image.getBoundingClientRect !== "function") {
      return;
    }
    const place = () => {
      if (!root.isConnected) {
        observer?.disconnect();
        return;
      }
      const hostBox = host.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      if (imageBox.width === 0 || hostBox.width === 0) {
        return;
      }
      root.style.top = `${imageBox.top - hostBox.top + MAIN_INSET}px`;
      root.style.right = `${hostBox.right - imageBox.right + MAIN_INSET}px`;
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(image);
    observer?.observe(host);
    place();
  };

  const attach = (host, illustId, variant) => {
    if (!host || typeof host.append !== "function" || host.querySelector?.(`[${ROOT_ATTR}="${variant}"]`)) {
      return;
    }
    const root = createButton(illustId);
    root.setAttribute(ROOT_ATTR, variant);
    pinHost(host);
    host.append(root);
    if (variant === "main") {
      pinToImage(root, host);
    }
  };

  const injectThumbnails = () => {
    for (const link of thumbnailLinks(document)) {
      attach(thumbnailHost(link), illustIdFrom(link.getAttribute("href")), "grid");
    }
  };

  // One button per artwork page, not one per manga page: a single click already
  // downloads every page of the work.
  const injectMainIllust = () => {
    const illustId = illustIdFrom(window.location.pathname);
    const existing = document.querySelector(`[${ROOT_ATTR}="main"]`);
    if (existing && existing.dataset.illust !== illustId) {
      existing.remove();
    }
    if (!isIllustId(illustId) || document.querySelector(`[${ROOT_ATTR}="main"]`)) {
      return;
    }
    attach(mainIllustHosts(document)[0], illustId, "main");
  };

  const scan = () => {
    injectThumbnails();
    injectMainIllust();
  };

  scan();
  const observer = new MutationObserver(() => {
    if (scan.queued) {
      return;
    }
    scan.queued = true;
    // Not requestAnimationFrame: a background tab never runs it, so this latch
    // would stay set forever and pixiv would never get a button. The delay is
    // longer than the X one because pixiv re-renders its whole virtualized grid.
    window.setTimeout(() => {
      scan.queued = false;
      scan();
    }, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
