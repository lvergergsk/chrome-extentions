(() => {
  const { isPinId, mediaFromProps, pinIdFromUrl, isAllowedMediaUrl } = globalThis.UtilsPinterestMedia;
  const ROOT = "data-utils-pinterest-download";
  const ICON = "M12 17.41 6.29 11.7l1.42-1.41L11 13.59V4h2v9.59l3.29-3.3 1.42 1.41L12 17.41zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z";
  const timers = new WeakMap();

  const propsFrom = (doc) => {
    try {
      return JSON.parse(doc.querySelector("#__PWS_INITIAL_PROPS__")?.textContent ?? "null");
    } catch {
      return null;
    }
  };

  const resolveMedia = async (pinId, host) => {
    const initial = mediaFromProps(propsFrom(document), pinId);
    if (initial) return initial;
    try {
      const response = await fetch(`/pin/${pinId}/`, { credentials: "include" });
      if (response.ok) {
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const media = mediaFromProps(propsFrom(doc), pinId);
        if (media) return media;
      }
    } catch {}
    // Grid images expose their original URL in srcset even after SPA navigation.
    const srcset = host.querySelector("img[srcset]")?.getAttribute("srcset") ?? "";
    const url = srcset.match(/https:\/\/i\.pinimg\.com\/originals\/[^\s,]+/)?.[0];
    if (host.querySelector("video") || !isAllowedMediaUrl(url)) return null;
    return { url, ext: new URL(url).pathname.split(".").pop().toLowerCase() };
  };

  const setStatus = (root, message, state) => {
    clearTimeout(timers.get(root));
    root.dataset.state = state;
    root.querySelector("span").textContent = message;
    root.querySelector("button").disabled = state === "loading";
    if (state !== "loading") {
      timers.set(root, setTimeout(() => {
        root.dataset.state = "idle";
        root.querySelector("span").textContent = "";
      }, 5000));
    }
  };

  const createButton = (pinId, host, variant) => {
    const root = document.createElement("div");
    root.className = "utils-pinterest-download";
    root.setAttribute(ROOT, variant);
    root.dataset.pinId = pinId;
    root.dataset.state = "idle";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "下载 Pin 原图或视频");
    button.title = "下载 Pin 原图或视频";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON);
    icon.append(path);
    button.append(icon);
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("pointerdown", stop);
    button.addEventListener("click", async (event) => {
      stop(event);
      setStatus(root, "正在获取媒体…", "loading");
      try {
        const media = await resolveMedia(pinId, host);
        if (!media) throw new Error("media-unavailable");
        const result = await chrome.runtime.sendMessage({ type: "utils.pinterest.download", pinId, ...media });
        if (!result?.ok) throw new Error(result?.error ?? "download-failed");
        setStatus(root, result.pending ? "已开始下载" : "下载完成", "ok");
      } catch {
        setStatus(root, "下载失败，请重试", "error");
      }
    });
    root.append(button, status);
    return root;
  };

  const attach = (host, pinId, variant) => {
    if (!host || !isPinId(pinId)) return;
    const existing = host.querySelector(`:scope > [${ROOT}]`);
    if (existing?.dataset.pinId === pinId) return;
    existing?.remove();
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(createButton(pinId, host, variant));
  };

  const scan = () => {
    for (const card of document.querySelectorAll('[data-test-id="pinWrapper"]')) {
      const link = card.querySelector('a[href^="/pin/"]');
      attach(link?.querySelector(".PinCard__imageWrapper"), pinIdFromUrl(link?.getAttribute("href")), "grid");
    }
    const id = pinIdFromUrl(location.href);
    if (id) attach(document.querySelector(`[id="closeup-image-container-${id}"]`), id, "main");
  };

  scan();
  new MutationObserver(() => {
    if (scan.queued) return;
    scan.queued = true;
    setTimeout(() => {
      scan.queued = false;
      scan();
    }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
