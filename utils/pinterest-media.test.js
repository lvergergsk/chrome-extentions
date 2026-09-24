import assert from "node:assert/strict";
import test from "node:test";
import "./pinterest-media-core.js";

const { isPinId, isAllowedMediaUrl, mainMediaHost, mediaFromProps, pinIdFromUrl } = globalThis.UtilsPinterestMedia;

test("finds pin IDs without accepting other links", () => {
  assert.equal(pinIdFromUrl("/pin/17170042326047894/"), "17170042326047894");
  assert.equal(pinIdFromUrl("https://jp.pinterest.com/pin/123/?x=1"), "123");
  assert.equal(pinIdFromUrl("/search/pins/"), null);
  assert.equal(isPinId("../123"), false);
});

test("downloads the original image and the largest direct MP4, never a video poster", () => {
  const image = { id: "1", images: { orig: { url: "https://i.pinimg.com/originals/a.webp" } } };
  const video = {
    id: "2",
    images: { orig: { url: "https://i.pinimg.com/originals/poster.jpg" } },
    videos: { video_list: {
      V_HLSV4: { url: "https://v1.pinimg.com/videos/a.m3u8", width: 2000 },
      V_360P: { url: "https://v1.pinimg.com/videos/a_360w.mp4", width: 360 },
      V_720P: { url: "https://v1.pinimg.com/videos/a_720w.mp4", width: 720 },
    } },
  };
  const props = { initialReduxState: { pins: { 1: image, 2: video } } };
  assert.deepEqual(mediaFromProps(props, "1"), { url: image.images.orig.url, ext: "webp" });
  assert.deepEqual(mediaFromProps(props, "2"), { url: video.videos.video_list.V_720P.url, ext: "mp4" });
  assert.equal(mediaFromProps({ initialReduxState: { pins: { 2: { ...video, videos: {} } } } }, "2"), null);
});

test("only Pinterest image and direct video hosts are downloadable", () => {
  assert.equal(isAllowedMediaUrl("https://i.pinimg.com/originals/a.webp"), true);
  assert.equal(isAllowedMediaUrl("https://v1.pinimg.com/videos/a.mp4"), true);
  for (const url of ["http://i.pinimg.com/a.jpg", "https://i.pinimg.com.evil.test/a.jpg", "https://v1.pinimg.com/a.m3u8", "blob:https://jp.pinterest.com/a"]) {
    assert.equal(isAllowedMediaUrl(url), false, url);
  }
});

test("detail button attaches to image and video closeups", () => {
  const image = {};
  const video = {};
  const doc = { querySelector: (selector) => ({
    '[id="closeup-image-container-1"]': image,
    '[data-test-id="closeup-video-with-visibility"][data-pin-drag-id="2"]': video,
  })[selector] ?? null };
  assert.equal(mainMediaHost(doc, "1"), image);
  assert.equal(mainMediaHost(doc, "2"), video);
  assert.equal(mainMediaHost(doc, "../2"), null);
});
