import "./x-media-core.js";
import "./pixiv-media-core.js";
import { filterUnvisited } from "./sukebei-open-unseen-bg.js";

const {
  downloadFilename,
  harvestTweetMedia,
  isAllowedMediaUrl,
  isMediaList,
  mergeMedia,
  syndicationUrl,
  tweetStatusUrl,
} = globalThis.UtilsXMedia;

const {
  downloadFilename: pixivDownloadFilename,
  dedupeUrls: pixivDedupeUrls,
  isIllustId,
} = globalThis.UtilsPixivMedia;

const cache = new Map();

const cacheMedia = (tweetId, media) => {
  const id = String(tweetId ?? "");
  if (!id || !isMediaList(media) || media.length === 0) {
    return;
  }
  cache.set(id, mergeMedia([cache.get(id) ?? [], media]));
};

const fetchSyndication = async (tweetId) => {
  const response = await fetch(syndicationUrl(tweetId), { credentials: "omit" });
  if (!response.ok) {
    return [];
  }
  const harvested = harvestTweetMedia(await response.json());
  return harvested.get(String(tweetId)) ?? [...harvested.values()].flat();
};

const downloadTweet = async ({ tweetId, media }) => {
  const id = tweetId ? String(tweetId) : "tweet";
  let syndicated = [];
  if (tweetId) {
    try {
      syndicated = await fetchSyndication(tweetId);
    } catch {
      syndicated = [];
    }
  }
  const items = mergeMedia([cache.get(id) ?? [], syndicated, isMediaList(media) ? media : []]).filter((item) =>
    isAllowedMediaUrl(item.url),
  );
  if (items.length === 0) {
    return { ok: false, count: 0, error: "empty" };
  }
  let count = 0;
  let lastError = "";
  for (const [index, item] of items.entries()) {
    try {
      await chrome.downloads.download({
        url: item.url,
        filename: `utils-x/${downloadFilename(id, index, item.url)}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
      count += 1;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  if (count === 0) {
    return { ok: false, count: 0, error: lastError || "empty" };
  }
  return { ok: true, count };
};

// i.pximg.net rejects any request without a pixiv Referer, and the downloads API
// sends none. rules/pixiv-referer.json puts one back on the way out; without that
// static rule every one of these downloads comes back 403.
const downloadPixiv = async ({ illustId, urls }) => {
  const id = isIllustId(illustId) ? String(illustId) : "pixiv";
  const items = pixivDedupeUrls(Array.isArray(urls) ? urls : []);
  if (items.length === 0) {
    return { ok: false, count: 0, error: "empty" };
  }
  let count = 0;
  let lastError = "";
  for (const [index, url] of items.entries()) {
    try {
      await chrome.downloads.download({
        url,
        filename: `utils-pixiv/${pixivDownloadFilename(id, index, url)}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
      count += 1;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  if (count === 0) {
    return { ok: false, count: 0, error: lastError || "empty" };
  }
  return { ok: true, count };
};

const waitForTab = (tabId) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("tab-timeout")), 15000);
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    const finish = (error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        finish();
      }
    }, finish);
  });

const likeTweet = async (tweetId) => {
  const url = tweetStatusUrl(tweetId);
  if (!url) {
    return { ok: false, error: "bad-id" };
  }
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    return await chrome.tabs.sendMessage(tab.id, {
      type: "utils.x.like.current",
      tweetId: String(tweetId),
    });
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "utils.reload") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
    // Let the response and the tab removal settle before the context disappears.
    setTimeout(() => chrome.runtime.reload(), 50);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "utils.x.cache") {
    cacheMedia(message.tweetId, message.media);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "utils.x.download") {
    downloadTweet(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, count: 0, error: String(error?.message ?? error) });
      });
    return true;
  }
  if (message?.type === "utils.pixiv.download") {
    downloadPixiv(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, count: 0, error: String(error?.message ?? error) });
      });
    return true;
  }
  if (message?.type === "utils.x.like") {
    likeTweet(message.tweetId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  if (message?.type === "utils.sukebei.filterUnvisited") {
    const urls = Array.isArray(message.urls) ? message.urls.filter((url) => typeof url === "string") : [];
    filterUnvisited(urls, (url) => chrome.history.getVisits({ url }))
      .then((unseen) => sendResponse({ ok: true, urls: unseen }))
      .catch((error) => {
        sendResponse({ ok: false, urls: [], error: String(error?.message ?? error) });
      });
    return true;
  }
  if (message?.type === "utils.sukebei.openTab") {
    const url = typeof message.url === "string" ? message.url : "";
    if (!/^https?:\/\/([^/]*\.)?sukebei\.nyaa\.si\//i.test(url)) {
      sendResponse({ ok: false, error: "bad-url" });
      return;
    }
    chrome.tabs.create({ url, active: false })
      .then(() => chrome.history.addUrl({ url }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message ?? error) });
      });
    return true;
  }
});
