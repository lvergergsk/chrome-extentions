import {
  downloadFilename,
  harvestTweetMedia,
  isAllowedMediaUrl,
  isMediaList,
  mergeMedia,
  syndicationUrl,
} from "./x-media-core.js";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
});
