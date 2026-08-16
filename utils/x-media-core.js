const ALLOWED_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);
const VIDEO_THUMB_RE = /\/(ext_tw_video_thumb|tweet_video_thumb|amplify_video_thumb)\//i;

export function syndicationToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function syndicationUrl(tweetId) {
  const id = String(tweetId);
  return `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en&token=${syndicationToken(id)}`;
}

export function isMediaList(media) {
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

export function isAllowedMediaUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function toOriginalImageUrl(urlString) {
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

export function pickBestMp4(variants) {
  return (variants ?? [])
    .filter((variant) => variant && typeof variant.url === "string")
    .filter((variant) => {
      const type = String(variant.content_type ?? variant.contentType ?? "");
      return type === "video/mp4" || /\.mp4(?:$|\?)/i.test(variant.url);
    })
    .filter((variant) => isAllowedMediaUrl(variant.url))
    .sort((left, right) => (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0))[0] ?? null;
}

export function extractTweetId(hrefs) {
  for (const href of hrefs ?? []) {
    const match = String(href).match(/\/status\/(\d+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function downloadFilename(tweetId, index, urlString) {
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

export function harvestTweetMedia(data, into = new Map()) {
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
    considerNode(value, into);
    for (const child of Object.values(value)) {
      walk(child, depth + 1);
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

export function mergeMedia(groups) {
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

export function firstOwnMatch(article, selector) {
  if (!article || typeof article.querySelectorAll !== "function" || typeof selector !== "string") {
    return null;
  }
  return [...article.querySelectorAll(selector)].find((node) => belongsToArticle(node, article)) ?? null;
}

export function collectDomMedia(article) {
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

export function tweetHasVisibleMedia(article) {
  if (!article || typeof article.querySelectorAll !== "function") {
    return false;
  }
  return [...article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video, img[src*="pbs.twimg.com/media/"]')]
    .some((node) => belongsToArticle(node, article));
}
