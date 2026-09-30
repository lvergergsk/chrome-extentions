(() => {
  const origin = "https://pawchive.pw";
  const authorPattern = /^\/(fanbox|patreon|discord)\/user\/([^/]+)\/?$/;
  const postPattern = /^\/(fanbox|patreon|discord)\/user\/([^/]+)\/post\/([^/]+)\/?$/;
  const safeId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  const validIdentity = (value, requirePost = true) => value &&
    ["fanbox", "patreon", "discord"].includes(value.platform) && safeId(value.authorId) &&
    (requirePost ? safeId(value.postId) : value.postId == null || safeId(value.postId));

  const parsePageUrl = (value) => {
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password) return null;
      const match = postPattern.exec(url.pathname) ?? authorPattern.exec(url.pathname);
      if (!match || !safeId(match[2]) || (match[3] && !safeId(match[3]))) return null;
      return { platform: match[1], authorId: match[2], postId: match[3] ?? null };
    } catch { return null; }
  };

  const mediaKey = (value) => {
    try {
      if (typeof value !== "string") return null;
      const url = new URL(value);
      const match = /^\/data\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]{64})(\.[a-z0-9]{1,10})?$/i.exec(url.pathname);
      if (url.origin !== "https://file.pawchive.pw" || url.username || url.password || !match ||
          value.split(/[?#]/)[0] !== url.origin + url.pathname ||
          match[1].toLowerCase() !== match[3].slice(0, 2).toLowerCase() ||
          match[2].toLowerCase() !== match[3].slice(2, 4).toLowerCase()) return null;
      return match[3].toLowerCase();
    } catch { return null; }
  };

  const validMessage = (message, sender, extensionId) => {
    const page = parsePageUrl(sender?.url);
    if (sender?.id !== extensionId || sender?.tab?.id == null || sender.frameId !== 0 ||
        !page || !validIdentity(message, false) || message.platform !== page.platform ||
        message.authorId !== page.authorId || (page.postId && message.postId !== page.postId)) return false;
    const action = message.type?.replace("utils.pawchive.", "");
    if (["inspect", "preview", "submit"].includes(action)) return Array.isArray(message.posts) &&
      message.posts.length <= 10000 && message.posts.every((post) => validIdentity(post) &&
        post.platform === page.platform && post.authorId === page.authorId &&
        (!message.postId || post.postId === message.postId));
    if (action === "watch") return !page.postId && typeof message.enabled === "boolean";
    return ["status", "retry", "stop"].includes(action);
  };

  const safeName = (value) => {
    const name = String(value ?? "").replace(/\\/g, "/").split("/").pop()
      .replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+|[. ]+$/g, "").trim();
    const clean = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name || "file";
    const ext = /\.[a-z0-9]{1,10}$/i.exec(clean)?.[0] ?? "";
    return clean.length > 160 ? clean.slice(0, 160 - ext.length) + ext : clean;
  };

  const filename = (post, file) => {
    const name = safeName(file.name);
    const dot = name.lastIndexOf(".");
    const stem = (dot > 0 ? name.slice(0, dot) : name).slice(0, 100);
    const ext = dot > 0 ? name.slice(dot, dot + 12) : "";
    return `utils-pawchive/${post.platform}/${safeName(post.authorId)}/${safeName(post.postId)}/${stem}-${file.key}${ext}`;
  };

  const extractPost = (doc, url) => {
    const id = parsePageUrl(url);
    if (!id?.postId) return null;
    const section = doc.querySelector(".site-section--post[data-service][data-user][data-id]");
    if (!section || section.dataset.service !== id.platform || section.dataset.user !== id.authorId ||
        section.dataset.id !== id.postId) return null;
    const files = new Map();
    let unavailable = false;
    for (const link of section.querySelectorAll(".post__attachment-link[href], .post__files a.fileThumb[href], .post__videos video[src], .post__videos source[src]")) {
      let href;
      try { href = new URL(link.getAttribute("href") || link.getAttribute("src"), origin).href; }
      catch { unavailable = true; continue; }
      const key = mediaKey(href);
      if (!key) unavailable = true;
      if (key && !files.has(key)) {
        const parsed = new URL(href);
        files.set(key, { key, url: parsed.origin + parsed.pathname,
          name: safeName(link.getAttribute("download") || parsed.searchParams.get("f") || parsed.pathname.split("/").pop()) });
      }
    }
    return { ...id, files: [...files.values()], unavailable: unavailable || !files.size,
      unavailableReason: unavailable ? "unsupported" : !files.size ? "unarchived" : null };
  };

  const authorLinks = (doc, author) => {
    const header = doc.querySelector(".user-header[data-service][data-id]");
    if (header?.dataset.service !== author.platform || header?.dataset.id !== author.authorId) throw new Error("page-unavailable");
    const posts = new Set();
    const pages = new Set();
    for (const link of doc.querySelectorAll("a[href]")) {
      let url;
      try { url = new URL(link.getAttribute("href"), origin); } catch { continue; }
      const id = parsePageUrl(url.href);
      if (!id || id.platform !== author.platform || id.authorId !== author.authorId) continue;
      if (id.postId && link.closest(".post-card")) posts.add(url.origin + url.pathname);
      else if (!id.postId && /^\d+$/.test(url.searchParams.get("o") ?? "")) {
        const offset = Number(url.searchParams.get("o"));
        if (Number.isSafeInteger(offset)) pages.add(`${origin}/${author.platform}/user/${author.authorId}${offset ? `?o=${offset}` : ""}`);
      }
    }
    const count = doc.querySelector(".paginator small")?.textContent.match(/\bof\s+([\d,]+)/i)?.[1];
    return { posts: [...posts], pages: [...pages], count: count ? Number(count.replaceAll(",", "")) : null };
  };

  // `known` post IDs turn this into an update check: pages list newest first, so stop at the first page with nothing new.
  const authorPosts = async (author, load, { signal, progress = () => {}, known } = {}) => {
    const root = `${origin}/${author.platform}/user/${author.authorId}`;
    if (!validIdentity(author, false)) throw new Error("bad-author");
    const pending = [root], seen = new Set(), links = new Set();
    const isKnown = (url) => known?.has(parsePageUrl(url).postId);
    let expected = null, caughtUp = false;
    while (pending.length) {
      if (signal?.aborted) throw new Error("cancelled");
      const page = pending.shift();
      if (seen.has(page)) continue;
      seen.add(page);
      // A missing page means the author count is unknown; never present a partial batch as complete.
      const doc = await load(page, signal);
      const found = authorLinks(doc, author);
      if (found.count != null) {
        if (expected != null && expected !== found.count) throw new Error("author-changed");
        expected = found.count;
      }
      found.posts.forEach((url) => links.add(url));
      if (known && found.posts.every(isKnown)) { caughtUp = true; break; }
      found.pages.forEach((url) => { if (!seen.has(url) && !pending.includes(url)) pending.push(url); });
      progress({ phase: "pages", done: seen.size, total: seen.size + pending.length, posts: links.size });
    }
    if (!caughtUp && expected != null && links.size !== expected) throw new Error("pages-incomplete");
    return [...links].filter((url) => !isKnown(url));
  };

  const loadPosts = async (urls, load, { signal, progress = () => {} } = {}) => {
    const posts = new Array(urls.length), unavailable = [];
    let cursor = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (cursor < urls.length) {
        if (signal?.aborted) throw new Error("cancelled");
        const index = cursor++;
        try {
          const post = extractPost(await load(urls[index], signal), urls[index]);
          if (!post) throw new Error("unavailable");
          posts[index] = post;
          if (post.unavailable) unavailable.push(urls[index]);
        } catch (error) {
          if (signal?.aborted) throw new Error("cancelled");
          unavailable.push(urls[index]);
        }
        progress({ phase: "posts", done: ++done, total: urls.length, unavailable: unavailable.length });
      }
    }));
    return { posts: posts.filter(Boolean), unavailable };
  };

  const collectAuthor = async (author, load, options = {}) => {
    const urls = await authorPosts(author, load, options);
    return { ...await loadPosts(urls, load, options), count: urls.length };
  };

  globalThis.UtilsPawchive = { parsePageUrl, validIdentity, validMessage, mediaKey, safeName, filename, extractPost, authorLinks,
    authorPosts, loadPosts, collectAuthor };
})();
