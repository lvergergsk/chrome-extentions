import test from "node:test";
import assert from "node:assert/strict";
import "./pawchive-core.js";

const { parsePageUrl, mediaKey, safeName, filename, authorLinks, extractPost, collectAuthor } = globalThis.UtilsPawchive;
const author = { platform: "fanbox", authorId: "123" };
const base = "https://pawchive.pw/fanbox/user/123";
const post = `${base}/post/456`;
const hash = "aabb" + "c".repeat(60);
const file = `https://file.pawchive.pw/data/aa/bb/${hash}.jpg?f=cover.jpg`;

const link = (href, card = false, name = null) => ({ href, getAttribute: (key) => key === "href" ? href : name,
  closest: () => card ? {} : null });
const list = (links) => ({ querySelectorAll: () => links });
const detail = (urls) => ({ querySelector: () => ({ dataset: { service: "fanbox", user: "123", id: "456" },
  querySelectorAll: () => urls.map((url) => link(url, false, "../cover.jpg")) }) });

test("validates page and original file links and sanitizes filenames", () => {
  assert.deepEqual(parsePageUrl(`${base}/post/456?q=1`), { ...author, postId: "456" });
  assert.equal(parsePageUrl("https://evil.test/fanbox/user/123"), null);
  assert.equal(mediaKey(file), hash);
  assert.equal(mediaKey(file.replace("file.pawchive.pw", "img.pawchive.pw")), null);
  assert.equal(mediaKey("https://file.pawchive.pw/data/aa/bb/../../evil.jpg"), null);
  assert.equal(safeName("../../bad:cover.jpg"), "bad_cover.jpg");
  assert.match(filename({ ...author, postId: "456" }, { key: hash, name: "cover.jpg" }), /cover-aabbc+\.jpg$/);
});

test("collects every author page and original attachments, counting unavailable posts", async () => {
  const pages = new Map([
    [base, list([link(`${base}?o=50`), link(post, true)])],
    [`${base}?o=0`, list([link(post, true)])],
    [`${base}?o=50`, list([link(`${base}?o=0`), link(`${base}/post/789`, true)])],
    [post, detail([file, file.replace("?f=cover.jpg", "?f=renamed.jpg")])],
  ]);
  const result = await collectAuthor(author, async (url) => {
    if (!pages.has(url)) throw new Error("missing");
    return pages.get(url);
  });
  assert.equal(result.count, 2);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].files.length, 1);
  assert.deepEqual(result.unavailable, [`${base}/post/789`]);
  assert.equal(extractPost(detail([file]), post).files[0].url, file.split("?")[0]);
});

test("fails closed on a missing page and respects cancellation", async () => {
  await assert.rejects(collectAuthor(author, async (url) => {
    if (url !== base) throw new Error("page failed");
    return list([link(`${base}?o=50`)]);
  }), /page failed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collectAuthor(author, async () => list([]), { signal: controller.signal }), /cancelled/);
  assert.deepEqual(authorLinks(list([link(`${base}/post/456`, true)]), author).posts, [post]);
});
