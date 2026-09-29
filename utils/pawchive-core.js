(() => {
  const origin = "https://pawchive.pw";
  const authorPattern = /^\/(fanbox|patreon|discord)\/user\/([^/]+)\/?$/;
  const postPattern = /^\/(fanbox|patreon|discord)\/user\/([^/]+)\/post\/([^/]+)\/?$/;
  const safeId = (value) => /^[a-zA-Z0-9_-]+$/.test(value ?? "");

  const parsePageUrl = (value) => {
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin) return null;
      const match = postPattern.exec(url.pathname) ?? authorPattern.exec(url.pathname);
      if (!match || !safeId(match[2]) || (match[3] && !safeId(match[3]))) return null;
      return { platform: match[1], authorId: match[2], postId: match[3] ?? null };
    } catch { return null; }
  };

  const mediaKey = (value) => {
    try {
      const url = new URL(value);
      const match = /^\/data\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]{64})(\.[a-z0-9]{1,10})?$/i.exec(url.pathname);
      if (url.protocol !== "https:" || url.hostname !== "file.pawchive.pw" || !match ||
          match[1] !== match[3].slice(0, 2) || match[2] !== match[3].slice(2, 4)) return null;
      return match[3].toLowerCase();
    } catch { return null; }
  };

  const safeName = (value) => {
    const name = String(value ?? "").replace(/\\/g, "/").split("/").pop()
      .replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+|[. ]+$/g, "").trim();
    return (name || "file").slice(0, 180);
  };

  const filename = (post, file) => {
    const name = safeName(file.name);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    return `utils-pawchive/${post.platform}/${post.authorId}/${post.postId}/${stem}-${file.key}${ext}`;
  };

  const extractPost = (doc, url) => {
    const id = parsePageUrl(url);
    if (!id?.postId) return null;
    const section = doc.querySelector(".site-section--post[data-service][data-user][data-id]");
    if (!section || section.dataset.service !== id.platform || section.dataset.user !== id.authorId ||
        section.dataset.id !== id.postId) return null;
    const files = new Map();
    for (const link of section.querySelectorAll(".post__attachment-link[href], .post__files a.fileThumb[href]")) {
      const href = link.href;
      const key = mediaKey(href);
      if (key && !files.has(key)) {
        const parsed = new URL(href);
        files.set(key, { key, url: parsed.origin + parsed.pathname,
          name: safeName(link.getAttribute("download") || parsed.searchParams.get("f") || parsed.pathname.split("/").pop()) });
      }
    }
    return { ...id, files: [...files.values()] };
  };

  const authorLinks = (doc, author) => {
    const posts = new Set();
    const pages = new Set();
    for (const link of doc.querySelectorAll("a[href]")) {
      const url = new URL(link.getAttribute("href"), origin);
      const id = parsePageUrl(url.href);
      if (!id || id.platform !== author.platform || id.authorId !== author.authorId) continue;
      if (id.postId && link.closest(".post-card")) posts.add(url.origin + url.pathname);
      else if (!id.postId && /^\d+$/.test(url.searchParams.get("o") ?? "")) pages.add(url.href);
    }
    return { posts: [...posts], pages: [...pages] };
  };

  const collectAuthor = async (author, load, { signal, progress = () => {} } = {}) => {
    const root = `${origin}/${author.platform}/user/${author.authorId}`;
    if (parsePageUrl(root)?.authorId !== author.authorId) throw new Error("bad-author");
    const pending = [root], seen = new Set(), links = new Set();
    while (pending.length) {
      if (signal?.aborted) throw new Error("cancelled");
      const page = pending.shift();
      if (seen.has(page)) continue;
      seen.add(page);
      // A missing page means the author count is unknown; never present a partial batch as complete.
      const doc = await load(page, signal);
      const found = authorLinks(doc, author);
      found.posts.forEach((url) => links.add(url));
      found.pages.forEach((url) => { if (!seen.has(url) && !pending.includes(url)) pending.push(url); });
      progress({ phase: "pages", done: seen.size, total: seen.size + pending.length, posts: links.size });
    }
    const urls = [...links];
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
        } catch (error) {
          if (signal?.aborted) throw new Error("cancelled");
          unavailable.push(urls[index]);
        }
        progress({ phase: "posts", done: ++done, total: urls.length, unavailable: unavailable.length });
      }
    }));
    return { posts: posts.filter(Boolean), unavailable, count: urls.length };
  };

  globalThis.UtilsPawchive = { parsePageUrl, mediaKey, safeName, filename, extractPost, authorLinks, collectAuthor };
})();
