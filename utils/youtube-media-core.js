// Classic content script shared by the YouTube page and isolated worlds.
(() => {
  const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function isVideoId(value) {
    return VIDEO_ID_RE.test(String(value ?? ""));
  }

  function videoIdFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname)) {
        return null;
      }
      const candidate = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      return isVideoId(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  function isAllowedMediaUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.protocol === "https:" && (url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com"));
    } catch {
      return false;
    }
  }

  function selectDownloadFormat(streamingData) {
    const candidates = (Array.isArray(streamingData?.formats) ? streamingData.formats : [])
      .filter(
        (format) =>
          format &&
          typeof format.url === "string" &&
          isAllowedMediaUrl(format.url) &&
          /^video\/(mp4|webm)\b/i.test(format.mimeType ?? "") &&
          (format.audioQuality || Number(format.audioChannels) > 0),
      )
      .sort((left, right) => Number(right.height ?? 0) - Number(left.height ?? 0) || Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0));
    const selected = candidates[0];
    return selected
      ? {
          url: selected.url,
          mimeType: selected.mimeType,
          qualityLabel: String(selected.qualityLabel ?? ""),
        }
      : null;
  }

  function downloadFilename(videoId, title, mimeType) {
    const id = isVideoId(videoId) ? String(videoId) : "youtube";
    const cleanTitle = String(title ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 120)
      .trim();
    const extension = /^video\/webm\b/i.test(mimeType ?? "") ? "webm" : "mp4";
    return `${cleanTitle || "YouTube video"} [${id}].${extension}`;
  }

  globalThis.UtilsYouTubeMedia = {
    downloadFilename,
    isAllowedMediaUrl,
    isVideoId,
    selectDownloadFormat,
    videoIdFromUrl,
  };
})();
