(() => {
  const FLAGS = ["[AI生成]", "アンソロジー"];
  const FLAG_CLASS = "utils-sukebei-flag";

  const collectParts = (text) => {
    const parts = [];
    let rest = text;
    while (rest.length > 0) {
      let hit = null;
      for (const flag of FLAGS) {
        const index = rest.indexOf(flag);
        if (index >= 0 && (!hit || index < hit.index)) {
          hit = { index, flag };
        }
      }
      if (!hit) {
        parts.push({ text: rest, flag: false });
        break;
      }
      if (hit.index > 0) {
        parts.push({ text: rest.slice(0, hit.index), flag: false });
      }
      parts.push({ text: hit.flag, flag: true });
      rest = rest.slice(hit.index + hit.flag.length);
    }
    return parts;
  };

  const isSukebeiHost = (hostname) => /(^|\.)sukebei\.nyaa\.si$/i.test(hostname);
  const isListPath = (pathname) => !pathname.startsWith("/view/");

  const highlightTextNode = (node) => {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 3)) {
      return;
    }
    if (node.nodeType === 3) {
      if (node.parentElement?.closest?.(`.${FLAG_CLASS}`)) {
        return;
      }
      const parts = collectParts(node.nodeValue ?? "");
      if (parts.length === 0 || (parts.length === 1 && !parts[0].flag)) {
        return;
      }
      const parent = node.parentNode;
      if (!parent) {
        return;
      }
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (part.flag) {
          const span = document.createElement("span");
          span.className = FLAG_CLASS;
          span.textContent = part.text;
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part.text));
        }
      }
      parent.replaceChild(frag, node);
      return;
    }
    if (node.matches?.("." + FLAG_CLASS)) {
      return;
    }
    for (const child of [...node.childNodes]) {
      highlightTextNode(child);
    }
  };

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
    for (const anchor of table.querySelectorAll('td[colspan] > a[href^="/view/"]')) {
      highlightTextNode(anchor);
    }
  };

  globalThis.UtilsSukebeiListFlags = {
    collectParts,
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
