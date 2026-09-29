(() => {
  const { parsePageUrl, extractPost, collectAuthor } = globalThis.UtilsPawchive;
  const DOWNLOAD = "M12 17.41 6.29 11.7l1.42-1.41L11 13.59V4h2v9.59l3.29-3.3 1.42 1.41L12 17.41zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z";
  const CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
  const views = new Map(), postCache = new Map(), fetchQueue = [];
  let page, pageKey, pageAbort, collection, dialog, panel, allButton, authorName = "", activeFetches = 0, refreshTimer;

  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const button = (label, action, icon = false) => {
    const element = node("button", "utils-pawchive-button");
    element.type = "button";
    if (icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", DOWNLOAD);
      svg.append(path);
      element.append(svg);
    }
    if (label) element.append(node("span", "", label));
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action();
    });
    return element;
  };
  const send = async (action, scope = page, extra = {}) => {
    const response = await chrome.runtime.sendMessage({ type: `utils.pawchive.${action}`, ...scope, ...extra });
    if (!response?.ok) throw new Error(response?.error ?? "background-unavailable");
    return response;
  };
  const postUrl = (scope) => `https://pawchive.pw/${scope.platform}/user/${scope.authorId}/post/${scope.postId}`;

  // Visible-post probes and full-author collection share the same three fetch slots.
  const runFetches = () => {
    while (activeFetches < 3 && fetchQueue.length) {
      const { url, signal, resolve, reject } = fetchQueue.shift();
      if (signal?.aborted) { reject(new Error("cancelled")); continue; }
      activeFetches++;
      const timeout = AbortSignal.timeout(30000);
      fetch(url, { credentials: "same-origin", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
        .then(async (response) => {
          if (!response.ok) throw new Error("page-unavailable");
          return new DOMParser().parseFromString(await response.text(), "text/html");
        }).then(resolve, reject).finally(() => { activeFetches--; runFetches(); });
    }
  };
  const load = (url, signal) => new Promise((resolve, reject) => {
    if (!parsePageUrl(url)) { reject(new Error("bad-url")); return; }
    fetchQueue.push({ url, signal, resolve, reject });
    runFetches();
  });
  const getPost = async (scope, signal, fresh = false) => {
    const url = postUrl(scope);
    if (!fresh && postCache.has(url)) return postCache.get(url);
    const promise = (async () => {
      const current = parsePageUrl(location.href);
      const doc = !fresh && current?.postId === scope.postId && current.authorId === scope.authorId && current.platform === scope.platform ? document : await load(url, signal);
      if (signal?.aborted) throw new Error("cancelled");
      const result = extractPost(doc, url);
      if (!result) throw new Error("post-unavailable");
      return result;
    })();
    postCache.set(url, promise);
    try { return await promise; } catch (error) { postCache.delete(url); throw error; }
  };

  const setPostState = (view, state) => {
    if (view.busy || !view.root.isConnected) return;
    view.state = state;
    const labels = {
      complete: "已下载", unavailable: state.unavailableReason === "unarchived" ? "站点未归档" :
        state.unavailableReason === "unsupported" ? "部分附件无法获取" : "无法获取帖子，点击重试", failed: `失败 ${state.failed} 项，点击重试`,
      active: `下载中 ${state.completed}/${state.total}`, queued: "排队中", stopped: "已停止，点击重试",
    };
    const label = labels[state.status] ?? "";
    text(view.label, label);
    view.root.dataset.state = state.status;
    view.button.title = label || "下载帖子原图、视频及附件";
    view.button.setAttribute("aria-label", view.button.title);
    view.path.setAttribute("d", state.status === "complete" ? CHECK : DOWNLOAD);
    view.button.disabled = ["active", "queued"].includes(state.status);
  };
  const setPanel = (title, description, action = null, progress = null) => {
    if (!panel?.root.isConnected) return;
    panel.root.hidden = !title;
    text(panel.title, title);
    text(panel.description, description);
    panel.action.hidden = !action;
    panel.action.onclick = action?.run ?? null;
    text(panel.action, action?.label ?? "");
    panel.progress.hidden = !progress;
    if (progress) { panel.progress.max = Math.max(1, progress.total); panel.progress.value = progress.done; }
  };
  const failPanel = () => setPanel("无法连接下载后台", "请刷新页面后重试。", { label: "重试", run: () => void refresh() });
  const refresh = async () => {
    const scope = page;
    if (!scope) return;
    try {
      const result = await send("status", scope);
      if (scope !== page) return;
      for (const view of views.values()) setPostState(view, result.postStates[view.scope.postId] ?? { status: "unknown" });
      if (collection || dialog) return;
      if (result.status === "unknown") { setPanel("", ""); return; }
      const pending = result.active + result.queued;
      const title = result.status === "stopped" ? "已停止下载" : pending ? result.active ? "正在下载" : "排队中" : result.missing ? "有待下载附件" : "下载结束";
      const detail = `已完成 ${result.completed} · 失败 ${result.failed}` +
        (result.unavailable ? ` · 无法获取帖子 ${result.unavailable}` : "") + (pending ? " · 关闭页面后继续" : "");
      const action = pending ? { label: "停止", run: () => void stopDownloads() } :
        result.failed || result.unavailable || result.status === "stopped" || result.missing ?
          { label: result.missing ? "下载缺失项" : "重试失败项", run: () => void retryDownloads() } : null;
      setPanel(title, detail, action, pending ? { done: result.completed, total: result.total } : null);
    } catch { if (scope === page) failPanel(); }
  };
  const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 100); };
  const stopDownloads = async () => {
    try { await send("stop"); await refresh(); } catch { failPanel(); }
  };

  const showConfirm = (scope, stats) => new Promise((resolve) => {
    const trigger = document.activeElement;
    const modal = node("dialog", "utils-pawchive-dialog");
    dialog = modal;
    modal.setAttribute("aria-labelledby", "utils-pawchive-confirm-title");
    const heading = node("h2", "", "下载作者全部附件");
    heading.id = "utils-pawchive-confirm-title";
    const author = node("p", "utils-pawchive-author", authorName || scope.authorId);
    const counts = node("dl", "utils-pawchive-counts");
    for (const [label, value] of [["帖子", stats.posts], ["待下载文件", stats.pending], ["重复文件", stats.duplicate], ["无法获取的帖子", stats.unavailable]]) {
      const row = node("div");
      row.append(node("dt", "", label), node("dd", "", String(value)));
      if (label === "无法获取的帖子" && value) row.className = "utils-pawchive-warning";
      counts.append(row);
    }
    const destination = node("p", "utils-pawchive-destination", `下载/utils-pawchive/${scope.platform}/${scope.authorId}/帖子ID/`);
    const note = node("p", "utils-pawchive-note", "原图、视频及附件（含封面）。关闭页面后继续下载。");
    const footer = node("div", "utils-pawchive-footer");
    const cancel = button("取消", () => modal.close("cancel"));
    cancel.autofocus = true;
    const confirm = button(stats.pending ? `下载 ${stats.pending} 个文件` : "确认记录", () => modal.close("download"));
    confirm.classList.add("utils-pawchive-primary");
    confirm.disabled = stats.posts === 0;
    footer.append(cancel, confirm);
    modal.append(heading, author, counts, destination, note, footer);
    modal.addEventListener("close", () => {
      const approved = modal.returnValue === "download";
      modal.remove();
      if (dialog === modal) dialog = null;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      resolve(approved);
    }, { once: true });
    document.body.append(modal);
    modal.showModal();
  });

  const beginCollection = () => {
    if (collection) return null;
    const controller = new AbortController();
    collection = controller;
    if (allButton) allButton.disabled = true;
    return { controller, signal: AbortSignal.any([controller.signal, pageAbort.signal]) };
  };
  const collectionProgress = (title, done, total, controller, description = "附件尚未下载，可随时取消。") =>
    setPanel(`${title} ${done}/${total}`, description, { label: "取消", run: () => controller.abort() }, { done, total });
  const endCollection = (controller) => {
    if (collection !== controller) return;
    collection = null;
    if (allButton) allButton.disabled = false;
  };
  const collectAll = async () => {
    const session = beginCollection();
    if (!session) return;
    const { controller, signal } = session, scope = page;
    let finished = false;
    try {
      collectionProgress("正在整理分页", 0, 1, controller);
      const result = await collectAuthor(scope, load, { signal, progress: (value) => {
        if (scope === page) collectionProgress(value.phase === "pages" ? "正在整理分页" : "正在整理帖子", value.done, value.total, controller);
      } });
      const posts = result.posts;
      for (const url of result.unavailable) {
        const id = parsePageUrl(url);
        if (!posts.some((post) => post.postId === id.postId)) posts.push({ ...id, files: [], unavailable: true, unavailableReason: "fetch-failed" });
      }
      const stats = await send("preview", scope, { posts });
      if (signal.aborted || scope !== page) return;
      setPanel("整理完成", `已整理 ${stats.posts} 篇帖子，等待确认。`);
      const approved = await showConfirm(scope, stats);
      if (approved && !signal.aborted && scope === page) await send("submit", scope, { posts });
      finished = true;
    } catch {
      if (!signal.aborted && scope === page) setPanel("分页或帖子整理失败", "未开始下载，请重新整理。", { label: "重新整理", run: () => void collectAll() });
    } finally {
      endCollection(controller);
      if (scope === page && allButton?.isConnected) allButton.focus({ preventScroll: true });
      if ((finished || signal.aborted) && scope === page) await refresh();
    }
  };

  const retryDownloads = async () => {
    const session = beginCollection();
    if (!session) return;
    const { controller, signal } = session, scope = page;
    try {
      const state = await send("status", scope);
      const posts = [], ids = [...new Set([...state.unavailablePosts, ...state.missingPosts])];
      let done = 0;
      collectionProgress("重新获取帖子", done, ids.length, controller, "完成整理后，仅重试缺失的附件。");
      await Promise.all(ids.map(async (postId) => {
        const id = { ...scope, postId };
        try { posts.push(await getPost(id, signal, true)); }
        catch { posts.push({ ...id, files: [], unavailable: true, unavailableReason: "fetch-failed" }); }
        if (scope === page) collectionProgress("重新获取帖子", ++done, ids.length, controller, "完成整理后，仅重试缺失的附件。");
      }));
      if (signal.aborted || scope !== page) return;
      if (posts.length) await send("submit", scope, { posts });
      await send("retry", scope);
    } catch { if (!signal.aborted && scope === page) failPanel(); }
    finally { endCollection(controller); if (scope === page) await refresh(); }
  };

  const probe = async (view) => {
    if (view.probed || view.busy || !view.root.isConnected) return;
    view.probed = true;
    const signal = pageAbort.signal;
    try {
      const post = await getPost(view.scope, signal);
      if (!signal.aborted) await send("inspect", view.scope, { posts: [post] });
    } catch {
      if (!signal.aborted) {
        try { await send("inspect", view.scope, { posts: [{ ...view.scope, files: [], unavailable: true, unavailableReason: "fetch-failed" }] }); }
        catch { failPanel(); }
      }
    }
    if (!signal.aborted) scheduleRefresh();
  };
  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) {
      visible.unobserve(entry.target);
      const view = views.get(entry.target.dataset.utilsPawchivePost);
      if (view) void probe(view);
    }
  }, { rootMargin: "100px" });

  const attachPost = (host, scope, detail = false) => {
    if (host.querySelector(".utils-pawchive-post")) return;
    const root = node("div", `utils-pawchive-post${detail ? " utils-pawchive-detail" : ""}`);
    root.dataset.utilsPawchivePost = scope.postId;
    const label = node("span", "utils-pawchive-post-status");
    label.setAttribute("role", "status");
    const view = { root, scope, label, busy: false, state: { status: "unknown" } };
    const control = button("", async () => {
      if (view.busy || view.state.status === "complete") return;
      view.busy = true;
      control.disabled = true;
      text(label, "正在获取附件…");
      const signal = pageAbort.signal;
      try {
        if (["failed", "stopped"].includes(view.state.status) && !view.state.unavailable) await send("retry", scope);
        else {
          const post = await getPost(scope, signal, view.state.status === "unavailable");
          if (signal.aborted) return;
          await send("submit", scope, { posts: [post] });
        }
      } catch {
        if (!signal.aborted) {
          try { await send("inspect", scope, { posts: [{ ...scope, files: [], unavailable: true, unavailableReason: "fetch-failed" }] }); }
          catch { failPanel(); }
        }
      } finally {
        view.busy = false;
        control.disabled = false;
        if (!signal.aborted) await refresh();
      }
    }, true);
    view.button = control;
    view.path = control.querySelector("path");
    control.title = "下载帖子原图、视频及附件";
    control.setAttribute("aria-label", control.title);
    root.append(control, label);
    host.append(root);
    views.set(scope.postId, view);
    visible.observe(root);
    if (!detail) {
      host.classList.add("utils-pawchive-card");
      const position = () => {
        const media = host.querySelector(".post-card__image-container");
        root.style.top = `${Math.max(8, (media?.getBoundingClientRect().top ?? host.getBoundingClientRect().top + 44) - host.getBoundingClientRect().top + 12)}px`;
      };
      position();
      const size = new ResizeObserver(position);
      size.observe(host);
      view.disconnect = () => size.disconnect();
    }
  };

  const scan = () => {
    const scope = parsePageUrl(location.href);
    const key = scope ? `${scope.platform}/${scope.authorId}/${scope.postId ?? ""}` : "";
    if (key !== pageKey) {
      pageAbort?.abort();
      collection?.abort();
      dialog?.close("cancel");
      collection = null;
      for (const view of views.values()) { view.disconnect?.(); view.root.remove(); }
      views.clear();
      visible.disconnect();
      allButton?.remove();
      panel?.root.remove();
      allButton = null;
      panel = null;
      page = scope;
      pageKey = key;
      pageAbort = new AbortController();
      postCache.clear();
    }
    if (!scope) return;
    for (const [id, view] of views) if (!view.root.isConnected) { view.disconnect?.(); views.delete(id); }
    const header = document.querySelector(scope.postId ? ".post__header" : ".user-header");
    if (!header) return;
    authorName = document.querySelector(scope.postId ? ".post__user-name" : ".user-header__name")?.textContent.trim() || scope.authorId;
    if (!panel?.root.isConnected) {
      const root = node("section", "utils-pawchive-panel");
      root.hidden = true;
      root.setAttribute("aria-label", "Pawchive 下载任务");
      const copy = node("div", "utils-pawchive-panel-copy"), title = node("strong"), description = node("p");
      copy.setAttribute("role", "status");
      copy.append(title, description);
      const progress = node("progress");
      progress.setAttribute("aria-label", "任务进度");
      progress.hidden = true;
      const action = button("", () => {});
      root.append(copy, action, progress);
      header.after(root);
      panel = { root, title, description, action, progress };
    }
    if (scope.postId) attachPost(document.querySelector(".post__actions") ?? header, scope, true);
    else {
      if (!allButton?.isConnected) {
        allButton = button("下载全部", collectAll, true);
        allButton.classList.add("utils-pawchive-all");
        (header.querySelector(".user-header__actions") ?? header).append(allButton);
      }
      for (const card of document.querySelectorAll(".post-card[data-service][data-user][data-id]")) {
        const id = parsePageUrl(card.querySelector("a[href]")?.href);
        if (id?.postId && id.platform === scope.platform && id.authorId === scope.authorId) attachPost(card, id);
      }
    }
  };
  let scanTimer;
  new MutationObserver((records) => {
    if (records.every((record) => record.target.closest?.('[class*="utils-pawchive"]'))) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scan(); scheduleRefresh(); }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pawchiveDownloadsV1) scheduleRefresh();
  });
  window.addEventListener("popstate", () => { scan(); scheduleRefresh(); });
  window.addEventListener("pagehide", () => { pageAbort?.abort(); collection?.abort(); });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) { pageKey = undefined; scan(); scheduleRefresh(); }
  });
  scan();
  void refresh();
})();
