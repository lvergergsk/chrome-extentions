const compare = (a, b) => String(a || "").localeCompare(String(b || ""));
const tabUrl = (tab) => tab.pendingUrl || tab.url || "";

export function sortTabs(tabs, sortBy) {
  if (!["url", "title"].includes(sortBy)) throw new Error("Sort by url or title.");
  const key = (tab) => {
    if (sortBy === "title") return tab.title;
    try {
      const url = new URL(tabUrl(tab));
      return url.hostname.replace(/^www\./i, "") + url.pathname + url.search + url.hash;
    } catch {
      return tabUrl(tab);
    }
  };
  return [...tabs].sort((a, b) => compare(key(a), key(b)) || a.index - b.index);
}

export function duplicateTabIds(tabs, includePinned = false) {
  const seen = new Set();
  const duplicates = [];
  const preferred = [...tabs].sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || Number(Boolean(b.active)) - Number(Boolean(a.active))
    || a.index - b.index,
  );
  for (const tab of preferred) {
    const url = tabUrl(tab);
    if (!url) continue;
    if (seen.has(url) && (includePinned || !tab.pinned)) duplicates.push(tab.id);
    seen.add(url);
  }
  return duplicates;
}

export const tabResult = (tab) => ({
  id: tab.id, windowId: tab.windowId, index: tab.index, groupId: tab.groupId,
  pinned: Boolean(tab.pinned), active: Boolean(tab.active),
  title: tab.title || "", url: tabUrl(tab),
});

// Serialize shortcut and CLI changes so they cannot interleave tab moves.
let tabWork = Promise.resolve();
export function queueTabWork(work) {
  const result = tabWork.then(work);
  tabWork = result.catch(() => {});
  return result;
}

export async function organizeTabs(params, api = chrome) {
  const sortBy = params.sortBy ?? "url";
  sortTabs([], sortBy);
  const window = params.windowId === undefined
    ? await api.windows.getLastFocused({ windowTypes: ["normal"] })
    : await api.windows.get(params.windowId);
  if (window.type !== "normal" || window.incognito) {
    throw new Error("Choose a normal, non-incognito Chrome window.");
  }
  const tabs = (await api.tabs.query({ windowId: window.id })).sort((a, b) => a.index - b.index);
  const duplicateIds = params.dedupe === false ? [] : duplicateTabIds(tabs, params.includePinned);
  const remaining = tabs.filter((tab) => !duplicateIds.includes(tab.id));
  const groups = (await api.tabGroups.query({ windowId: window.id }))
    .sort((a, b) => compare(a.title, b.title) || a.id - b.id);
  const pinned = remaining.filter((tab) => tab.pinned);
  const sections = [
    ...(params.includePinned ? [{ tabIds: sortTabs(pinned, sortBy).map((tab) => tab.id) }] : []),
    ...groups.map((group) => ({
      groupId: group.id,
      tabIds: sortTabs(remaining.filter((tab) => tab.groupId === group.id), sortBy).map((tab) => tab.id),
    })),
    { tabIds: sortTabs(remaining.filter((tab) => !tab.pinned && tab.groupId === -1), sortBy).map((tab) => tab.id) },
  ].filter((section) => section.tabIds.length);
  const result = {
    windowId: window.id, applied: Boolean(params.apply), sortBy,
    sorted: sections.reduce((count, section) => count + section.tabIds.length, 0),
    duplicates: tabs.filter((tab) => duplicateIds.includes(tab.id)).map(tabResult),
    sections,
  };
  if (!params.apply) return result;
  if (duplicateIds.length) await api.tabs.remove(duplicateIds);
  let index = params.includePinned ? 0 : pinned.length;
  for (const section of sections) {
    if (section.groupId !== undefined) await api.tabGroups.move(section.groupId, { index });
    // Move within each group's bounds; detaching a whole group can destroy its ID.
    // TODO: Verify Chrome on Windows preserves group metadata when moving within bounds.
    for (const tabId of section.tabIds) await api.tabs.move(tabId, { index: index++ });
  }
  return result;
}

export function planTabMoves(tabs, command, start, end) {
  if (!["tab-left", "tab-right", "tab-front", "tab-back"].includes(command)) {
    throw new Error("Unknown tab shortcut.");
  }
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  if (["tab-right", "tab-back"].includes(command)) ordered.reverse();
  return ordered.map((tab, position) => [tab.id,
    command === "tab-left" ? Math.max(start + position, tab.index - 1)
      : command === "tab-right" ? Math.min(end - position - 1, tab.index + 1)
        : command === "tab-front" ? start + position : end - position - 1,
  ]);
}

export async function moveHighlightedTabs(command, api = chrome, windowId) {
  const tabs = await api.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  for (const pinned of [true, false]) {
    const selected = tabs.filter((tab) => tab.highlighted && Boolean(tab.pinned) === pinned);
    for (const [tabId, index] of planTabMoves(selected, command, pinned ? 0 : pinnedCount, pinned ? pinnedCount : tabs.length)) {
      await api.tabs.move(tabId, { index });
    }
  }
}
