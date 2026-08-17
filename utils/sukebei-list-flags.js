(() => {
  const FLAGS = ["AI生成", "アンソロジー"];
  const FLAG_CLASS = "utils-sukebei-flag";

  const rowHasFlag = (text) => FLAGS.some((flag) => text.includes(flag));

  const isSukebeiHost = (hostname) => /(^|\.)sukebei\.nyaa\.si$/i.test(hostname);
  const isListPath = (pathname) => !pathname.startsWith("/view/");

  const highlightList = (root, loc) => {
    if (!root?.querySelectorAll || !loc) {
      return;
    }
    if (!isSukebeiHost(loc.hostname) || !isListPath(loc.pathname)) {
      return;
    }
    const table = root.querySelector("table.torrent-list") ??
      (root.matches?.("table.torrent-list") ? root : null);
    if (!table) {
      return;
    }
    for (const row of table.querySelectorAll("tbody tr")) {
      const title = row.querySelector('td[colspan] > a[href^="/view/"]');
      if (!title) {
        continue;
      }
      const haystack = `${title.textContent ?? ""} ${title.getAttribute("title") ?? ""}`;
      if (rowHasFlag(haystack)) {
        row.classList.add(FLAG_CLASS);
      }
    }
  };

  globalThis.UtilsSukebeiListFlags = {
    rowHasFlag,
    isSukebeiHost,
    isListPath,
    highlightList,
  };

  if (!globalThis.document || !globalThis.location) {
    return;
  }

  let queued = false;
  const schedule = () => {
    if (queued) {
      return;
    }
    queued = true;
    setTimeout(() => {
      queued = false;
      highlightList(document, location);
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
