(() => {
  const FLAG_CLASS = "utils-sukebei-flag";
  const SEEN_CLASS = "utils-sukebei-seen";
  const BAR_ID = "utils-sukebei-open-unseen";
  const INTERVAL_MS = 3000;

  const flags = () => globalThis.UtilsSukebeiListFlags;

  const collectUnflaggedViewUrls = (root, origin) => {
    const table = root.querySelector("table.torrent-list");
    if (!table) {
      return [];
    }
    const urls = [];
    for (const row of table.querySelectorAll("tbody tr")) {
      if (row.classList.contains(FLAG_CLASS)) {
        continue;
      }
      const title = row.querySelector('td[colspan] > a[href^="/view/"]');
      if (!title) {
        continue;
      }
      urls.push(new URL(title.getAttribute("href"), origin).href);
    }
    return urls;
  };

  const collectAllViewUrls = (root, origin) => {
    const table = root.querySelector("table.torrent-list");
    if (!table) {
      return [];
    }
    const urls = [];
    for (const title of table.querySelectorAll('td[colspan] > a[href^="/view/"]')) {
      urls.push(new URL(title.getAttribute("href"), origin).href);
    }
    return urls;
  };

  const markSeenUrls = (root, origin, urls) => {
    const wanted = new Set(urls);
    const table = root.querySelector("table.torrent-list");
    if (!table) {
      return 0;
    }
    let count = 0;
    for (const title of table.querySelectorAll('td[colspan] > a[href^="/view/"]')) {
      const href = new URL(title.getAttribute("href"), origin).href;
      if (!wanted.has(href)) {
        continue;
      }
      title.classList.add(SEEN_CLASS);
      count += 1;
    }
    return count;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const ask = (message) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });

  globalThis.UtilsSukebeiOpenUnseen = {
    collectUnflaggedViewUrls,
    collectAllViewUrls,
    markSeenUrls,
    SEEN_CLASS,
    INTERVAL_MS,
  };

  if (!globalThis.document || !globalThis.location) {
    return;
  }

  const listApi = flags();
  if (!listApi?.isSukebeiHost?.(location.hostname) || !listApi?.isListPath?.(location.pathname)) {
    return;
  }

  let runId = 0;
  let startedAt = 0;
  let painting = false;

  const paintVisitedFromHistory = async () => {
    if (painting) {
      return;
    }
    painting = true;
    try {
      const urls = collectAllViewUrls(document, location.origin);
      if (urls.length === 0) {
        return;
      }
      const filtered = await ask({ type: "utils.sukebei.filterUnvisited", urls });
      const unseen = new Set(filtered?.urls ?? []);
      markSeenUrls(
        document,
        location.origin,
        urls.filter((url) => !unseen.has(url)),
      );
    } catch {
      // History may be unavailable until the user grants the permission.
    } finally {
      painting = false;
    }
  };

  const ensureBar = () => {
    const table = document.querySelector("table.torrent-list");
    if (!table) {
      return null;
    }
    let bar = document.getElementById(BAR_ID);
    if (bar) {
      return bar;
    }
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "utils-sukebei-open";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "utils-sukebei-open__button";
    button.textContent = "打开未看过的条目";
    const status = document.createElement("span");
    status.className = "utils-sukebei-open__status";
    bar.append(button, status);
    table.parentNode.insertBefore(bar, table);

    button.addEventListener("click", async () => {
      if (button.dataset.busy === "1") {
        if (Date.now() - startedAt < 500) {
          return;
        }
        runId += 1;
        button.dataset.busy = "0";
        button.textContent = "打开未看过的条目";
        status.textContent = "已停止";
        return;
      }
      const current = ++runId;
      startedAt = Date.now();
      button.dataset.busy = "1";
      button.textContent = "停止";
      status.textContent = "正在核对浏览记录…";
      try {
        listApi.highlightList?.(document, location);
        const urls = collectUnflaggedViewUrls(document, location.origin);
        const filtered = await ask({ type: "utils.sukebei.filterUnvisited", urls });
        const unseen = filtered?.urls ?? [];
        if (unseen.length === 0) {
          if (current === runId) {
            status.textContent = "没有可打开的未看条目";
          }
          return;
        }
        for (const [index, url] of unseen.entries()) {
          if (current !== runId) {
            return;
          }
          status.textContent = `打开 ${index + 1}/${unseen.length}`;
          const opened = await ask({ type: "utils.sukebei.openTab", url });
          if (!opened?.ok) {
            if (current === runId) {
              status.textContent = opened?.error || "打开失败";
            }
            return;
          }
          markSeenUrls(document, location.origin, [url]);
          if (index < unseen.length - 1) {
            await sleep(INTERVAL_MS);
          }
        }
        if (current === runId) {
          status.textContent = `已打开 ${unseen.length} 页`;
        }
      } catch (error) {
        if (current === runId) {
          status.textContent = String(error?.message ?? error);
        }
      } finally {
        if (current === runId) {
          button.dataset.busy = "0";
          button.textContent = "打开未看过的条目";
        }
      }
    });
    return bar;
  };

  let queued = false;
  const schedule = () => {
    if (queued) {
      return;
    }
    queued = true;
    setTimeout(() => {
      queued = false;
      ensureBar();
      paintVisitedFromHistory();
    }, 50);
  };

  schedule();
  document.addEventListener("DOMContentLoaded", schedule);
  window.addEventListener("load", schedule);
  const observer = new MutationObserver(schedule);
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
