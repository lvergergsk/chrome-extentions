(() => {
  const isPinId = (value) => /^\d+$/.test(String(value ?? ""));

  const pinIdFromUrl = (value) => {
    try {
      const url = new URL(value, "https://jp.pinterest.com");
      if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/.test(url.hostname)) return null;
      return /^\/pin\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
    } catch {
      return null;
    }
  };

  const isAllowedMediaUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (
        (url.hostname === "i.pinimg.com" && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) ||
        (/^v\d+\.pinimg\.com$/.test(url.hostname) && /\.mp4$/i.test(url.pathname))
      );
    } catch {
      return false;
    }
  };

  const mediaFromProps = (props, pinId) => {
    const pin = props?.initialReduxState?.pins?.[pinId] ?? props?.resource_response?.data;
    if (!isPinId(pinId) || String(pin?.id) !== pinId) return null;
    let url;
    if (pin.is_video || pin.videos) {
      url = Object.values(pin.videos?.video_list ?? {})
        .filter((item) => isAllowedMediaUrl(item?.url) && item.url.endsWith(".mp4"))
        .sort((a, b) => (b.width ?? 0) * (b.height ?? 1) - (a.width ?? 0) * (a.height ?? 1))[0]?.url;
    } else {
      url = pin.images?.orig?.url ?? pin.images?.["1200x"]?.url;
    }
    if (!isAllowedMediaUrl(url)) return null;
    const ext = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    return { url, ext: ext === "jpeg" ? "jpg" : ext };
  };

  globalThis.UtilsPinterestMedia = { isPinId, isAllowedMediaUrl, mediaFromProps, pinIdFromUrl };
})();
