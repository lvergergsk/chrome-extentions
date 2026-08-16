// Classic content script: Chrome 151 ignores content_scripts.type=module, and every
// classic file in one content_scripts entry shares a single global lexical scope.
// Everything stays inside this IIFE so the only global we define is UtilsXMedia.
(() => {
  const ALLOWED_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);
  const VIDEO_THUMB_RE = /\/(ext_tw_video_thumb|tweet_video_thumb|amplify_video_thumb)\//i;

  function syndicationToken(tweetId) {
    return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  }

  function syndicationUrl(tweetId) {
    const id = String(tweetId);
    return `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en&token=${syndicationToken(id)}`;
  }

  function isMediaList(media) {
    return (
      Array.isArray(media) &&
      media.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.url === "string" &&
          (item.kind === "photo" || item.kind === "video" || item.kind === "gif"),
      )
    );
  }

  function isAllowedMediaUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }

  function toOriginalImageUrl(urlString) {
    try {
      const url = new URL(urlString);
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") {
        return null;
      }
      if (url.pathname.includes("/profile_") || VIDEO_THUMB_RE.test(url.pathname)) {
        return null;
      }
      if (!url.pathname.includes("/media/")) {
        return null;
      }

      url.pathname = url.pathname.replace(/:(small|medium|large|thumb|orig)$/i, "");
      const extensionMatch = url.pathname.match(/\/media\/([^/]+)\.(jpg|jpeg|png|webp)$/i);
      if (extensionMatch) {
        url.pathname = `/media/${extensionMatch[1]}`;
        const format = extensionMatch[2].toLowerCase() === "jpeg" ? "jpg" : extensionMatch[2].toLowerCase();
        url.searchParams.set("format", format);
      }
      url.searchParams.set("name", "orig");
      return url.toString();
    } catch {
      return null;
    }
  }

  function pickBestMp4(variants) {
    return (variants ?? [])
      .filter((variant) => variant && typeof variant.url === "string")
      .filter((variant) => {
        const type = String(variant.content_type ?? variant.contentType ?? "");
        return type === "video/mp4" || /\.mp4(?:$|\?)/i.test(variant.url);
      })
      .filter((variant) => isAllowedMediaUrl(variant.url))
      .sort((left, right) => (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0))[0] ?? null;
  }

  function extractTweetId(hrefs) {
    for (const href of hrefs ?? []) {
      const match = String(href).match(/\/status\/(\d+)/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  function downloadFilename(tweetId, index, urlString) {
    const safeId = String(tweetId ?? "tweet").replace(/[^\dA-Za-z]/g, "").slice(0, 32) || "tweet";
    let extension = "bin";
    try {
      const url = new URL(urlString);
      const pathExtension = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
      const format = url.searchParams.get("format")?.toLowerCase();
      extension = pathExtension || format || (url.hostname === "video.twimg.com" ? "mp4" : "jpg");
    } catch {
      extension = "bin";
    }
    if (extension === "jpeg") {
      extension = "jpg";
    }
    if (!/^(jpg|png|webp|mp4|gif)$/.test(extension)) {
      extension = String(urlString).includes("video.twimg.com") ? "mp4" : "jpg";
    }
    return `x-${safeId}-${Number(index) + 1}.${extension}`;
  }

  function tweetIdOf(node) {
    const raw = node.rest_id ?? node.id_str ?? (typeof node.id === "string" || typeof node.id === "number" ? node.id : null);
    if (raw == null) {
      return null;
    }
    const id = String(raw);
    return /^\d+$/.test(id) ? id : null;
  }

  function mediaListOf(node) {
    return (
      node.legacy?.extended_entities?.media ??
      node.extended_entities?.media ??
      node.mediaDetails ??
      node.legacy?.entities?.media ??
      null
    );
  }

  function parseMediaEntity(entity) {
    if (!entity || typeof entity !== "object") {
      return [];
    }
    if (entity.type === "video" || entity.type === "animated_gif") {
      const best = pickBestMp4(entity.video_info?.variants ?? entity.videoInfo?.variants ?? []);
      if (!best) {
        return [];
      }
      return [{ kind: entity.type === "animated_gif" ? "gif" : "video", url: best.url }];
    }
    const raw = entity.media_url_https ?? entity.media_url ?? (entity.type === "photo" ? entity.url : null);
    const url = raw ? toOriginalImageUrl(raw) : null;
    return url ? [{ kind: "photo", url }] : [];
  }

  function considerNode(node, into) {
    const id = tweetIdOf(node);
    const media = mediaListOf(node);
    if (!id || !Array.isArray(media) || media.length === 0) {
      return;
    }
    const parsed = media.flatMap(parseMediaEntity);
    if (parsed.length > 0) {
      into.set(id, parsed);
    }
  }

  // React props read from a fiber are not plain data: x.com defines getters such as
  // `store` that throw when touched, and Object.values would trigger them. Every
  // property read here is guarded so one hostile getter cannot kill the whole walk.
  function readProperty(value, key) {
    try {
      return value[key];
    } catch {
      return undefined;
    }
  }

  function harvestTweetMedia(data, into = new Map()) {
    const seen = new WeakSet();
    const walk = (value, depth) => {
      if (!value || depth > 30) {
        return;
      }
      if (typeof value !== "object") {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item, depth + 1);
        }
        return;
      }
      if (typeof Node === "function" && value instanceof Node) {
        return;
      }
      try {
        considerNode(value, into);
      } catch {
        // A throwing getter on this node tells us nothing; keep walking its children.
      }
      for (const key of Object.keys(value)) {
        walk(readProperty(value, key), depth + 1);
      }
    };
    walk(data, 0);
    return into;
  }

  function urlKey(urlString) {
    try {
      const url = new URL(urlString);
      url.searchParams.delete("tag");
      return `${url.hostname}${url.pathname}?${url.searchParams.toString()}`;
    } catch {
      return urlString;
    }
  }

  function mergeMedia(groups) {
    const seen = new Set();
    const merged = [];
    for (const item of (groups ?? []).flat()) {
      if (!item || !isAllowedMediaUrl(item.url)) {
        continue;
      }
      const key = urlKey(item.url);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ kind: item.kind, url: item.url });
    }
    const hasMotion = merged.some((item) => item.kind === "video" || item.kind === "gif");
    if (!hasMotion) {
      return merged;
    }
    return merged.filter((item) => item.kind !== "photo" || !VIDEO_THUMB_RE.test(item.url));
  }

  function belongsToArticle(node, article) {
    return typeof node.closest === "function" ? node.closest("article") === article : false;
  }

  function firstOwnMatch(article, selector) {
    if (!article || typeof article.querySelectorAll !== "function" || typeof selector !== "string") {
      return null;
    }
    return [...article.querySelectorAll(selector)].find((node) => belongsToArticle(node, article)) ?? null;
  }

  function collectDomMedia(article) {
    if (!article || typeof article.querySelectorAll !== "function") {
      return [];
    }
    const photos = [...article.querySelectorAll("img")]
      .filter((image) => belongsToArticle(image, article))
      .map((image) => toOriginalImageUrl(image.src))
      .filter(Boolean)
      .map((url) => ({ kind: "photo", url }));
    const videos = [...article.querySelectorAll("video, source")]
      .filter((node) => belongsToArticle(node, article))
      .map((node) => node.src)
      .filter((src) => isAllowedMediaUrl(src))
      .map((url) => ({ kind: "video", url }));
    return mergeMedia([photos, videos]);
  }

  const VISIBLE_MEDIA = [
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="previewInterstitial"]',
    "video",
    'img[src*="pbs.twimg.com/media/"]',
    'img[src*="pbs.twimg.com/ext_tw_video_thumb"]',
    'img[src*="pbs.twimg.com/amplify_video_thumb"]',
    'img[src*="pbs.twimg.com/tweet_video_thumb"]',
    'a[href*="/photo/"]',
    'a[href*="/video/"]',
  ].join(", ");

  function tweetHasVisibleMedia(article) {
    if (!article || typeof article.querySelectorAll !== "function") {
      return false;
    }
    return [...article.querySelectorAll(VISIBLE_MEDIA)].some((node) => belongsToArticle(node, article));
  }

  const ACTION_ANCHORS = [
    '[data-testid="bookmark"]',
    '[data-testid="removeBookmark"]',
    '[data-testid="like"]',
    '[data-testid="unlike"]',
    '[data-testid="reply"]',
    '[data-testid="retweet"]',
    '[data-testid="unretweet"]',
  ];

  const ACTION_MARKS = [
    '[data-testid="bookmark"], [data-testid="removeBookmark"]',
    '[data-testid="like"], [data-testid="unlike"]',
    '[data-testid="reply"]',
    '[data-testid="retweet"], [data-testid="unretweet"]',
  ];

  const ACTION_LABEL = /share|bookmark|like|reply|repost|分享|书签|喜欢|转帖|转发|回复|共有|ブックマーク|いいね|リポスト|返信/i;

  const MEDIA_HOSTS = [
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="previewInterstitial"]',
  ].join(", ");

  function isActionBar(node, article) {
    if (!node || node === article || !belongsToArticle(node, article) || typeof node.querySelector !== "function") {
      return false;
    }
    let hits = 0;
    for (const selector of ACTION_MARKS) {
      if (node.querySelector(selector)) {
        hits += 1;
      }
    }
    return hits >= 2;
  }

  function actionBarFrom(seed, article) {
    let node = seed;
    for (let depth = 0; depth < 12 && node && node !== article; depth += 1) {
      if (isActionBar(node, article)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function findActionHost(article) {
    if (!article || typeof article.querySelectorAll !== "function") {
      return null;
    }

    for (const selector of ACTION_ANCHORS) {
      const button = firstOwnMatch(article, selector);
      const host = button ? actionBarFrom(button, article) : null;
      if (host) {
        return host;
      }
    }

    const labeledGroup = [...article.querySelectorAll('[role="group"]')].find(
      (node) => belongsToArticle(node, article) && node.querySelectorAll?.("button").length >= 3,
    );
    if (labeledGroup) {
      return labeledGroup;
    }

    const actionButtons = [...article.querySelectorAll("button")].filter((button) => {
      if (!belongsToArticle(button, article)) {
        return false;
      }
      return ACTION_LABEL.test(`${button.getAttribute?.("aria-label") ?? ""} ${button.textContent ?? ""}`);
    });
    for (const button of actionButtons) {
      let row = button.parentElement;
      for (let depth = 0; depth < 6 && row && row !== article; depth += 1) {
        if (row.querySelectorAll?.("button").length >= 3) {
          return row;
        }
        row = row.parentElement;
      }
    }
    return null;
  }

  function findMediaHost(article) {
    return firstOwnMatch(article, MEDIA_HOSTS);
  }

  // The last cell of X's action bar (the share cell) is a single-column grid, so
  // appending into it stacks the button *under* share. Add a sibling cell instead
  // so the button sits in the row, right after share.
  function attachDownloadButton(host, root) {
    if (!host || typeof host.append !== "function" || !root) {
      return false;
    }
    host.append(root);
    return true;
  }

  globalThis.UtilsXMedia = {
    attachDownloadButton,
    collectDomMedia,
    downloadFilename,
    extractTweetId,
    findActionHost,
    findMediaHost,
    firstOwnMatch,
    harvestTweetMedia,
    isAllowedMediaUrl,
    isMediaList,
    mergeMedia,
    pickBestMp4,
    syndicationToken,
    syndicationUrl,
    toOriginalImageUrl,
    tweetHasVisibleMedia,
  };
})();
