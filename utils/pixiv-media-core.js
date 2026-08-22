// Classic content script: Chrome 151 ignores content_scripts.type=module, and every
// classic file in one content_scripts entry shares a single global lexical scope.
// Everything stays inside this IIFE so the only global we define is UtilsPixivMedia.
(() => {
  const IMAGE_HOST = "i.pximg.net";
  const ARTWORK_RE = /\/artworks\/(\d+)/;
  const ILLUST_ID_RE = /^\d+$/;
  // pixiv marks every thumbnail tile with a GA4 label. It is the only stable hook
  // left in the app: the class names are hashed CSS-in-JS and change on each build.
  const THUMBNAIL_LINK = 'a[data-ga4-label="thumbnail_link"]';
  const ORIGINAL_LINK = 'a[href*="i.pximg.net/img-original/"]';
  const PRESENTATION_IMAGE = '[role="presentation"] img[src*="i.pximg.net"]';
  const BOOKMARK_ENDPOINT = "https://www.pixiv.net/ajax/illusts/bookmarks/add";
  // 0 keeps the bookmark on the public profile, which is pixiv's own default; 1 hides it.
  const BOOKMARK_RESTRICT_PUBLIC = 0;
  // illustType 2 is うごイラ: a per-frame zip plus a delay table, not an image.
  const UGOIRA_TYPE = 2;

  function isIllustId(value) {
    return ILLUST_ID_RE.test(String(value ?? ""));
  }

  function isPixivImageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === IMAGE_HOST;
    } catch {
      return false;
    }
  }

  function illustIdFrom(value) {
    const match = String(value ?? "").match(ARTWORK_RE);
    return match ? match[1] : null;
  }

  function illustPageIndex(value) {
    const match = String(value ?? "").match(/_p(\d+)(?:[._]|$)/);
    return match ? Number(match[1]) : null;
  }

  function illustEndpoint(illustId) {
    return `https://www.pixiv.net/ajax/illust/${encodeURIComponent(String(illustId))}?lang=ja`;
  }

  function pagesEndpoint(illustId) {
    return `https://www.pixiv.net/ajax/illust/${encodeURIComponent(String(illustId))}/pages?lang=ja`;
  }

  // pixiv keeps its own page numbering in the file name (_p0, _p1 ...). Preserving
  // it beats a running index: re-downloading one page of a manga then lines up.
  function downloadFilename(illustId, index, urlString) {
    const safeId = String(illustId ?? "pixiv").replace(/[^\dA-Za-z]/g, "").slice(0, 32) || "pixiv";
    let extension = "jpg";
    try {
      extension = new URL(urlString).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? "jpg";
    } catch {
      extension = "jpg";
    }
    if (extension === "jpeg") {
      extension = "jpg";
    }
    if (!/^(jpg|png|gif|webp)$/.test(extension)) {
      extension = "jpg";
    }
    const page = illustPageIndex(urlString) ?? (Number.isInteger(index) ? index : 0);
    return `pixiv-${safeId}-p${page}.${extension}`;
  }

  function dedupeUrls(urls) {
    const seen = new Set();
    const merged = [];
    for (const url of urls ?? []) {
      if (typeof url !== "string" || !isPixivImageUrl(url) || seen.has(url)) {
        continue;
      }
      seen.add(url);
      merged.push(url);
    }
    return merged;
  }

  function isUgoira(illust) {
    return Number(illust?.illustType) === UGOIRA_TYPE;
  }

  // bookmarkData is an object once the work is bookmarked and null while it is not,
  // and it already rides along in the list responses pixiv draws its own heart from.
  function isBookmarked(illust) {
    return illust?.bookmarkData != null;
  }

  function bookmarkPayload(illustId, restrict = BOOKMARK_RESTRICT_PUBLIC) {
    return {
      illust_id: String(illustId),
      restrict: Number(restrict) === 1 ? 1 : BOOKMARK_RESTRICT_PUBLIC,
      comment: "",
      tags: [],
    };
  }

  // /ajax/illust/{id} already carries page 0; /pages is only fetched for multi-page
  // works, so both shapes have to merge into one ordered, de-duplicated list.
  function originalUrls(illust, pages) {
    const fromPages = Array.isArray(pages) ? pages.map((page) => page?.urls?.original) : [];
    const single = [illust?.urls?.original];
    return dedupeUrls([...fromPages, ...single]);
  }

  // pixiv is a Next.js app now: the CSRF token the bookmark endpoint wants lives in a
  // JSON string nested inside the __NEXT_DATA__ JSON, not in a meta tag any more.
  // The old meta#meta-global-data still appears on legacy pages, so try both.
  function csrfTokenFromNextData(text) {
    try {
      const raw = JSON.parse(text)?.props?.pageProps?.serverSerializedPreloadedState;
      const state = typeof raw === "string" ? JSON.parse(raw) : raw;
      const token = state?.api?.token;
      return typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  function csrfTokenFromLegacyMeta(content) {
    try {
      const token = JSON.parse(content)?.token;
      return typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  function csrfToken(root) {
    if (!root || typeof root.querySelector !== "function") {
      return null;
    }
    const next = root.querySelector("#__NEXT_DATA__");
    const fromNext = next ? csrfTokenFromNextData(next.textContent) : null;
    if (fromNext) {
      return fromNext;
    }
    const legacy = root.querySelector('meta[name="global-data"], #meta-global-data');
    return legacy ? csrfTokenFromLegacyMeta(legacy.content ?? legacy.getAttribute?.("content")) : null;
  }

  function hasImage(node) {
    return !!node?.querySelector?.(`img[src*="${IMAGE_HOST}"]`);
  }

  // Title links point at /artworks/ too, so matching the href alone would hang a
  // button off every caption. A tile is a GA4-labelled link, or any link that
  // actually wraps a pixiv thumbnail.
  function thumbnailLinks(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }
    const links = [...root.querySelectorAll(THUMBNAIL_LINK)];
    for (const link of root.querySelectorAll('a[href*="/artworks/"]')) {
      if (!links.includes(link) && hasImage(link)) {
        links.push(link);
      }
    }
    return links.filter((link) => isIllustId(illustIdFrom(link.getAttribute?.("href"))));
  }

  // A GA4 tile sits inside the sized wrapper pixiv already positions relative, which
  // is exactly the box the overlay should cover. A fallback link is its own box, so
  // its parent is usually a whole row and would throw the button across the page.
  function thumbnailHost(link) {
    if (link?.getAttribute?.("data-ga4-label") === "thumbnail_link") {
      const parent = link.parentElement;
      if (parent && typeof parent.append === "function") {
        return parent;
      }
    }
    return link && typeof link.append === "function" ? link : null;
  }

  function mainIllustHosts(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }
    const anchors = [...root.querySelectorAll(ORIGINAL_LINK)];
    if (anchors.length > 0) {
      return anchors;
    }
    // Without the full-size link (an unexpanded or gated work) the presentation
    // wrapper around the master image is the only host left.
    return [...root.querySelectorAll(PRESENTATION_IMAGE)].map((image) => image.parentElement).filter(Boolean);
  }

  // Last resort when the ajax call fails: the full-size links on an artwork page
  // already point at the originals.
  function domOriginalUrls(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }
    return dedupeUrls([...root.querySelectorAll(ORIGINAL_LINK)].map((link) => link.href ?? link.getAttribute?.("href")));
  }

  globalThis.UtilsPixivMedia = {
    BOOKMARK_ENDPOINT,
    BOOKMARK_RESTRICT_PUBLIC,
    bookmarkPayload,
    csrfToken,
    csrfTokenFromLegacyMeta,
    csrfTokenFromNextData,
    dedupeUrls,
    domOriginalUrls,
    downloadFilename,
    illustEndpoint,
    illustIdFrom,
    illustPageIndex,
    isBookmarked,
    isIllustId,
    isPixivImageUrl,
    isUgoira,
    mainIllustHosts,
    originalUrls,
    pagesEndpoint,
    thumbnailHost,
    thumbnailLinks,
  };
})();
