import "./x-media-core.js";
import "./pixiv-media-core.js";
import {
  ALARM_SCHEDULES,
  checkInAll,
  ensureCheckinAlarms,
} from "./hoyolab-checkin.js";
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
  mapLimited,
} = globalThis.UtilsPixivMedia;

// A manga can run to dozens of pages; pulling them all at once would hammer pixiv.
const PIXIV_FETCH_CONCURRENCY = 3;

const hoyolabAlarmNames = new Set(ALARM_SCHEDULES.map(({ name }) => name));
let hoyolabRun;

const runHoyolabCheckin = () => {
  if (!hoyolabRun) {
    hoyolabRun = checkInAll()
      .then((results) => {
        for (const result of results) {
          const message = `[HoYoLAB] ${result.game}: ${result.status}${result.error ? ` (${result.error})` : ""}`;
          (result.status === "failed" || result.status === "login-required" ? console.warn : console.info)(message);
        }
        return results;
      })
      .finally(() => {
        hoyolabRun = null;
      });
  }
  return hoyolabRun;
};

ensureCheckinAlarms(chrome.alarms).catch(() => console.warn("[HoYoLAB] failed to schedule check-in"));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (hoyolabAlarmNames.has(alarm.name)) {
    void runHoyolabCheckin();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void ensureCheckinAlarms(chrome.alarms);
  void runHoyolabCheckin();
});

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

// chrome.downloads.download resolves as soon as the transfer is queued, so a 403
// from i.pximg.net still looks like a started download. Wait for the item to reach
// a terminal state and report what actually happened.
const DOWNLOAD_SETTLE_MS = 25000;

const settleDownload = (downloadId) =>
  new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const stateOf = (state, error) => {
      if (state === "complete") {
        return { ok: true };
      }
      if (state === "interrupted") {
        return { ok: false, error: error || "interrupted" };
      }
      return null;
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) {
        return;
      }
      const result = stateOf(delta.state?.current, delta.error?.current);
      if (result) {
        finish(result);
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    // A big illustration on a slow link is still fine: a timeout means "still
    // running", never "failed".
    const timer = setTimeout(() => finish({ ok: true, pending: true }), DOWNLOAD_SETTLE_MS);
    // A download that already finished before the listener attached never fires
    // onChanged at all.
    chrome.downloads
      .search({ id: downloadId })
      .then(([item]) => {
        const result = item ? stateOf(item.state, item.error) : null;
        if (result) {
          finish(result);
        }
      })
      .catch(() => {});
  });

// Service workers do not expose URL.createObjectURL, so a data URL is the only way
// to hand fetched bytes to the downloads API. Building it here keeps the work off
// the renderer, where a 20 MB illustration froze the tab.
const toDataUrl = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
};

const downloadSource = async (blob) => {
  try {
    return { url: URL.createObjectURL(blob), revoke: true };
  } catch {
    return { url: await toDataUrl(blob), revoke: false };
  }
};

// i.pximg.net answers 403 without a pixiv Referer. The downloads API cannot send
// one (Referer is an unsafe header there) and Chrome does not apply a
// declarativeNetRequest rule to a downloads-API request either — but it does apply
// one to this fetch, so the worker pulls the bytes itself and downloads those.
const downloadPixiv = async ({ illustId, urls }) => {
  const id = isIllustId(illustId) ? String(illustId) : "pixiv";
  const items = pixivDedupeUrls(Array.isArray(urls) ? urls : []);
  if (items.length === 0) {
    return { ok: false, count: 0, error: "empty" };
  }
  const results = await mapLimited(items, PIXIV_FETCH_CONCURRENCY, async (url, index) => {
    let source;
    try {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) {
        return { ok: false, error: `http-${response.status}` };
      }
      source = await downloadSource(await response.blob());
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
    let result;
    try {
      const downloadId = await chrome.downloads.download({
        url: source.url,
        filename: `utils-pixiv/${pixivDownloadFilename(id, index, url)}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
      result = await settleDownload(downloadId);
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
    // Never revoke while the transfer is still running: settleDownload reports
    // `pending` when it gave up waiting, not when the download failed.
    if (source.revoke && !result.pending) {
      URL.revokeObjectURL(source.url);
    }
    return result;
  });
  const count = results.filter((result) => result.ok).length;
  const error = results.find((result) => !result.ok)?.error ?? "";
  if (count === 0) {
    return { ok: false, count: 0, error: error || "empty" };
  }
  return { ok: true, count, failed: results.length - count, error };
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
