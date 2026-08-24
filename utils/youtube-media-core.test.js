import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./youtube-media-core.js";

const {
  downloadFilename,
  isAllowedMediaUrl,
  selectDownloadFormat,
  videoIdFromUrl,
} = globalThis.UtilsYouTubeMedia;

test("videoIdFromUrl supports YouTube watch pages and Shorts", () => {
  assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFromUrl("https://www.youtube.com/shorts/TqW4zXfDdiQ?feature=share"), "TqW4zXfDdiQ");
  assert.equal(videoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(videoIdFromUrl("https://www.youtube.com/feed/subscriptions"), null);
});

test("selectDownloadFormat chooses the best muxed direct stream", () => {
  const url360 = "https://rr1---sn.example.googlevideo.com/videoplayback?id=360";
  const url720 = "https://rr1---sn.example.googlevideo.com/videoplayback?id=720";
  const selected = selectDownloadFormat({
    formats: [
      {
        url: url360,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        qualityLabel: "360p",
        height: 360,
        bitrate: 500_000,
        audioQuality: "AUDIO_QUALITY_LOW",
      },
      {
        url: url720,
        mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
        qualityLabel: "720p",
        height: 720,
        bitrate: 1_500_000,
        audioQuality: "AUDIO_QUALITY_MEDIUM",
      },
    ],
    adaptiveFormats: [
      {
        url: "https://rr1---sn.example.googlevideo.com/videoplayback?id=2160",
        mimeType: 'video/mp4; codecs="av01.0.12M.08"',
        qualityLabel: "2160p",
        height: 2160,
        bitrate: 8_000_000,
      },
    ],
  });

  assert.deepEqual(selected, {
    url: url720,
    mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
    qualityLabel: "720p",
  });
});

test("selectDownloadFormat rejects ciphers and untrusted media hosts", () => {
  assert.equal(
    selectDownloadFormat({
      formats: [
        {
          signatureCipher: "s=encrypted",
          mimeType: 'video/mp4; codecs="avc1, mp4a"',
          audioQuality: "AUDIO_QUALITY_LOW",
        },
        {
          url: "https://example.com/video.mp4",
          mimeType: 'video/mp4; codecs="avc1, mp4a"',
          audioQuality: "AUDIO_QUALITY_LOW",
        },
      ],
    }),
    null,
  );
});

test("Googlevideo validation and download names stay inside the YouTube folder", () => {
  assert.equal(isAllowedMediaUrl("https://rr1---sn.example.googlevideo.com/videoplayback?id=1"), true);
  assert.equal(isAllowedMediaUrl("http://rr1---sn.example.googlevideo.com/videoplayback?id=1"), false);
  assert.equal(isAllowedMediaUrl("https://googlevideo.com.evil.example/video"), false);
  assert.equal(
    downloadFilename("dQw4w9WgXcQ", 'Rick: Never / Gonna * Give? <You> | Up.', "video/mp4"),
    "Rick Never Gonna Give You Up [dQw4w9WgXcQ].mp4",
  );
});

test("manifest injects the YouTube bridge and button on watch and Shorts pages", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
  const youtubeEntries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.includes("https://www.youtube.com/*"),
  );

  assert.equal(manifest.host_permissions.includes("https://*.googlevideo.com/*"), true);
  assert.deepEqual(
    youtubeEntries.map(({ js, css, world }) => ({ js, css, world })),
    [
      {
        js: ["youtube-media-core.js", "youtube-media-page.js"],
        world: "MAIN",
        css: undefined,
      },
      {
        js: ["youtube-media-core.js", "youtube-media.js"],
        css: ["youtube-media.css"],
        world: "ISOLATED",
      },
    ],
  );
});
