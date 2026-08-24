// Runs in YouTube's ISOLATED world: owns the native-looking button and delegates
// stream resolution to the MAIN-world bridge.
(() => {
  const { isAllowedMediaUrl, isVideoId, videoIdFromUrl } = globalThis.UtilsYouTubeMedia;
  const SOURCE = "utils-youtube-media";
  const ROOT_ATTR = "data-utils-youtube-download";
  const statusTimers = new WeakMap();

  const ICONS = {
    idle: "M11 4h2v9.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V4zM5 19h14v2H5v-2z",
    loading: "M11 4h2v9.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V4zM5 19h14v2H5v-2z",
    ok: "m9 16.17-3.59-3.58L4 14l5 5L20 8l-1.41-1.41L9 16.17z",
    error: "M12 5V2l-4 4 4 4V7c3.31 0 6 2.69 6 6 0 1.18-.34 2.27-.93 3.2l1.46 1.46A7.93 7.93 0 0 0 20 13c0-4.42-3.58-8-8-8zM6.93 9.8 5.47 8.34A7.93 7.93 0 0 0 4 13c0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6 0-1.18.34-2.27.93-3.2z",
  };
  const LABELS = { idle: "Download", loading: "Downloading…", ok: "Downloaded", error: "Retry" };

  const askPage = (videoId) =>
    new Promise((resolve) => {
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
          finish(data.result);
        }
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ source: SOURCE, type: "resolve", requestId, videoId }, window.location.origin);
      const timer = window.setTimeout(() => finish({ ok: false, error: "timeout" }), 8000);
    });

  const setState = (root, state) => {
    const button = root.querySelector(".utils-youtube-download__button");
    const status = root.querySelector(".utils-youtube-download__status");
    if (!button || !status) {
      return;
    }
    root.dataset.state = state;
    root.querySelector(".utils-youtube-download__path")?.setAttribute("d", ICONS[state]);
    for (const label of root.querySelectorAll(".utils-youtube-download__label")) {
      label.textContent = LABELS[state];
    }
    status.textContent = LABELS[state];
    button.disabled = state === "loading";
    button.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    window.clearTimeout(statusTimers.get(root));
    if (state === "ok" || state === "error") {
      statusTimers.set(root, window.setTimeout(() => setState(root, "idle"), 3600));
    }
  };

  const downloadCurrentVideo = async (root) => {
    setState(root, "loading");
    const videoId = videoIdFromUrl(window.location.href);
    const resolved = videoId && (await askPage(videoId));
    if (
      !resolved?.ok ||
      resolved.videoId !== videoId ||
      !isVideoId(resolved.videoId) ||
      !isAllowedMediaUrl(resolved.url)
    ) {
      setState(root, "error");
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: "utils.youtube.download", ...resolved });
      setState(root, response?.ok ? "ok" : "error");
    } catch {
      setState(root, "error");
    }
  };

  const icon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("utils-youtube-download__icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS.idle);
    path.classList.add("utils-youtube-download__path");
    svg.append(path);
    return svg;
  };

  const createButton = (kind) => {
    const root = document.createElement("div");
    root.className = `utils-youtube-download utils-youtube-download--${kind}`;
    root.setAttribute(ROOT_ATTR, kind);
    root.dataset.state = "idle";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "utils-youtube-download__button";
    button.setAttribute("aria-label", "Download video");
    button.setAttribute("aria-busy", "false");
    button.title = "Download video";

    const buttonLabel = document.createElement("span");
    buttonLabel.className = "utils-youtube-download__label utils-youtube-download__label--button";
    buttonLabel.textContent = LABELS.idle;
    button.append(icon(), buttonLabel);

    const railLabel = document.createElement("span");
    railLabel.className = "utils-youtube-download__label utils-youtube-download__label--rail";
    railLabel.setAttribute("aria-hidden", "true");
    railLabel.textContent = LABELS.idle;

    const status = document.createElement("span");
    status.className = "utils-youtube-download__status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");

    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("pointerdown", stop);
    button.addEventListener("click", (event) => {
      stop(event);
      void downloadCurrentVideo(root);
    });
    root.append(button, railLabel, status);
    return root;
  };

  const visibleShareButton = (scope) =>
    [...(scope?.querySelectorAll('button[aria-label^="Share"]') ?? [])].find(
      (button) => !button.closest(".html5-video-player") && button.getClientRects().length > 0,
    ) ?? null;

  const injectWatch = () => {
    if (!/^\/watch$/.test(window.location.pathname) || document.querySelector(`[${ROOT_ATTR}="watch"]`)) {
      return;
    }
    const actions = document.querySelector("ytd-watch-metadata #actions");
    const share = visibleShareButton(actions);
    const wrapper = share?.closest("yt-button-view-model, ytd-button-renderer") ?? share?.closest("button-view-model");
    wrapper?.after(createButton("watch"));
  };

  const injectShorts = () => {
    if (!window.location.pathname.startsWith("/shorts/")) {
      return;
    }
    const active =
      document.querySelector("ytd-reel-video-renderer[is-active]") ??
      [...document.querySelectorAll("ytd-reel-video-renderer")].find((renderer) => renderer.getClientRects().length > 0);
    if (!active || active.querySelector(`[${ROOT_ATTR}="shorts"]`)) {
      return;
    }
    const share = visibleShareButton(active);
    const wrapper = share?.closest("button-view-model");
    wrapper?.after(createButton("shorts"));
  };

  const scan = () => {
    injectWatch();
    injectShorts();
  };

  scan();
  const observer = new MutationObserver(() => {
    if (scan.queued) {
      return;
    }
    scan.queued = true;
    window.setTimeout(() => {
      scan.queued = false;
      scan();
    }, 16);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
