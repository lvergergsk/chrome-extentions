import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDomMedia,
  downloadFilename,
  extractTweetId,
  firstOwnMatch,
  harvestTweetMedia,
  isAllowedMediaUrl,
  isMediaList,
  mergeMedia,
  pickBestMp4,
  syndicationToken,
  syndicationUrl,
  toOriginalImageUrl,
  tweetHasVisibleMedia,
} from "./x-media-core.js";

test("syndicationToken matches the known react-tweet formula", () => {
  assert.equal(syndicationToken("719484841172054016"), "1qsbtgrhag1");
});

test("syndicationUrl encodes the tweet id and token", () => {
  assert.equal(
    syndicationUrl("719484841172054016"),
    "https://cdn.syndication.twimg.com/tweet-result?id=719484841172054016&lang=en&token=1qsbtgrhag1",
  );
});

test("toOriginalImageUrl upgrades modern query-name images", () => {
  assert.equal(
    toOriginalImageUrl("https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=small"),
    "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=orig",
  );
});

test("toOriginalImageUrl upgrades legacy colon-size images", () => {
  assert.equal(
    toOriginalImageUrl("https://pbs.twimg.com/media/CfwfpnJWwAEXwe3.jpg:large"),
    "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=orig",
  );
});

test("toOriginalImageUrl rejects profile pictures and non-https hosts", () => {
  assert.equal(
    toOriginalImageUrl("https://pbs.twimg.com/profile_images/123/avatar_normal.jpg"),
    null,
  );
  assert.equal(toOriginalImageUrl("http://pbs.twimg.com/media/CfwfpnJWwAEXwe3.jpg"), null);
  assert.equal(toOriginalImageUrl("https://evil.example/media/x.jpg"), null);
});

test("isMediaList accepts only photo/video/gif objects with a url", () => {
  assert.equal(isMediaList([{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }]), true);
  assert.equal(isMediaList([{ kind: "other", url: "https://pbs.twimg.com/media/a.jpg" }]), false);
  assert.equal(isMediaList("nope"), false);
});

test("isAllowedMediaUrl only allows X media hosts over https", () => {
  assert.equal(isAllowedMediaUrl("https://video.twimg.com/ext_tw_video/1/pu/vid/720x720/a.mp4"), true);
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/media/abc.jpg"), true);
  assert.equal(isAllowedMediaUrl("https://evil.example/a.mp4"), false);
  assert.equal(isAllowedMediaUrl("blob:https://x.com/123"), false);
});

test("pickBestMp4 selects the highest-bitrate mp4 and skips HLS", () => {
  const best = pickBestMp4([
    { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/pu/pl/a.m3u8" },
    { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/480x480/low.mp4" },
    { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/720x720/high.mp4" },
  ]);
  assert.equal(best.url, "https://video.twimg.com/ext_tw_video/1/pu/vid/720x720/high.mp4");
});

test("harvestTweetMedia reads syndication photos and graphql videos", () => {
  const syndication = {
    id_str: "719484841172054016",
    mediaDetails: [
      {
        type: "photo",
        media_url_https: "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3.jpg",
      },
    ],
  };
  const graphql = {
    data: {
      tweet_results: {
        result: {
          rest_id: "99",
          legacy: {
            extended_entities: {
              media: [
                {
                  type: "video",
                  video_info: {
                    variants: [
                      { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/ext_tw_video/99/low.mp4" },
                      { content_type: "video/mp4", bitrate: 5000000, url: "https://video.twimg.com/ext_tw_video/99/high.mp4" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  };

  const photos = harvestTweetMedia(syndication);
  assert.deepEqual(photos.get("719484841172054016"), [
    { kind: "photo", url: "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=orig" },
  ]);

  const videos = harvestTweetMedia(graphql);
  assert.deepEqual(videos.get("99"), [
    { kind: "video", url: "https://video.twimg.com/ext_tw_video/99/high.mp4" },
  ]);
});

test("mergeMedia dedupes and drops video thumbnails when a video exists", () => {
  const merged = mergeMedia([
    [{ kind: "photo", url: "https://pbs.twimg.com/ext_tw_video_thumb/99/pu/img/thumb.jpg" }],
    [{ kind: "video", url: "https://video.twimg.com/ext_tw_video/99/high.mp4" }],
    [{ kind: "video", url: "https://video.twimg.com/ext_tw_video/99/high.mp4" }],
  ]);
  assert.deepEqual(merged, [{ kind: "video", url: "https://video.twimg.com/ext_tw_video/99/high.mp4" }]);
});

test("extractTweetId reads the first status id and ignores unrelated hrefs", () => {
  assert.equal(
    extractTweetId(["/home", "/edent/status/719484841172054016/photo/1", "/i/status/20"]),
    "719484841172054016",
  );
  assert.equal(extractTweetId(["/explore"]), null);
});

test("downloadFilename stays inside a safe x-prefixed name", () => {
  assert.equal(
    downloadFilename("719484841172054016", 0, "https://pbs.twimg.com/media/abc?format=jpg&name=orig"),
    "x-719484841172054016-1.jpg",
  );
  assert.equal(
    downloadFilename("../evil", 1, "https://video.twimg.com/ext_tw_video/1/a.mp4"),
    "x-evil-2.mp4",
  );
});

test("collectDomMedia keeps only this article's pbs media images", () => {
  const article = {
    querySelectorAll(selector) {
      if (selector === "img") {
        return [
          { src: "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=small", closest: () => article },
          { src: "https://pbs.twimg.com/profile_images/1/a.jpg", closest: () => article },
          { src: "https://pbs.twimg.com/media/Quoted.jpg", closest: () => ({}) },
        ];
      }
      if (selector === "video, source") {
        return [{ src: "https://video.twimg.com/tweet_video/gif.mp4", closest: () => article }];
      }
      return [];
    },
  };

  assert.deepEqual(collectDomMedia(article), [
    { kind: "photo", url: "https://pbs.twimg.com/media/CfwfpnJWwAEXwe3?format=jpg&name=orig" },
    { kind: "video", url: "https://video.twimg.com/tweet_video/gif.mp4" },
  ]);
});

test("firstOwnMatch ignores nodes that belong to a nested article", () => {
  const inner = {};
  const outer = {
    querySelectorAll() {
      return [{ closest: () => inner }];
    },
  };
  assert.equal(firstOwnMatch(outer, "[data-utils-x-download]"), null);
});

test("tweetHasVisibleMedia ignores quoted nested articles", () => {
  const quoted = {};
  const article = {
    querySelectorAll() {
      return [{ closest: () => quoted }];
    },
  };
  assert.equal(tweetHasVisibleMedia(article), false);
});
