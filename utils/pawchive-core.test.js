import test from "node:test";
import assert from "node:assert/strict";
import "./pawchive-core.js";

const { parsePageUrl, validMessage, mediaKey, safeName, filename, authorLinks, extractPost, collectAuthor } = globalThis.UtilsPawchive;
const author = { platform: "fanbox", authorId: "123" };
const base = "https://pawchive.pw/fanbox/user/123";
const post = `${base}/post/456`;
const hash = "aabb" + "c".repeat(60);
const file = `https://file.pawchive.pw/data/aa/bb/${hash}.jpg?f=cover.jpg`;
const link = (href, card = false, name = null) => ({ getAttribute: (key) => key === "href" ? href : key === "download" ? name : null,
  closest: () => card ? {} : null });
const list = (links, count = null) => ({ querySelectorAll: () => links, querySelector: (selector) => selector.startsWith(".user-header") ?
  { dataset: { service: "fanbox", id: "123" } } : count == null ? null : { textContent: `Showing 1 - 50 of ${count}` } });
const detail = (urls, postId = "456") => ({ querySelector: () => ({ dataset: { service: "fanbox", user: "123", id: postId },
  querySelectorAll: () => urls.map((url) => link(url, false, "../cover.jpg")) }) });

test("validates original paths and preserves full hash with safe bounded filenames", () => {
  assert.deepEqual(parsePageUrl(`${post}?q=1`), { ...author, postId: "456" });
  assert.equal(parsePageUrl("https://evil.test/fanbox/user/123"), null);
  assert.equal(parsePageUrl("https://me:secret@pawchive.pw/fanbox/user/123"), null);
  assert.equal(mediaKey(file), hash);
  for (const invalid of [file.replace("file.pawchive.pw", "img.pawchive.pw"), file.replace("https:", "http:"),
    file.replace("file.pawchive.pw", "file.pawchive.pw:8443"), file.replace("file.pawchive.pw", "user@file.pawchive.pw"),
    file.replace("/data/", "/bad/../data/"), file.replace("/aa/bb/", "/bb/aa/"), "javascript:alert(1)"]) assert.equal(mediaKey(invalid), null);
  assert.equal(safeName("../../bad:cover.jpg"), "bad_cover.jpg");
  assert.equal(safeName("CON.txt"), "_CON.txt");
  const path = filename({ ...author, postId: "456" }, { key: hash, name: "x".repeat(1000) + ".jpg" });
  assert.ok(path.split("/").at(-1).length < 255);
  assert.ok(path.endsWith(hash + ".jpg"));
  assert.match(filename({ ...author, postId: "456" }, { key: hash, name: "cover.jpg" }), /cover-aabbc+\.jpg$/);
});

test("collects all unfiltered pages, canonicalizes offsets and reports unavailable posts", async () => {
  const calls = [];
  const pages = new Map([
    [base, list([link(`${base}?q=ignored&o=50`), link(post, true), link("http://[", true)], 2)],
    [`${base}?o=50`, list([link(`${base}?o=0`), link(`${base}/post/789`, true)], 2)],
    [post, detail([file, file.replace("?f=cover.jpg", "?f=renamed.jpg")])],
  ]);
  const result = await collectAuthor(author, async (url) => {
    calls.push(url);
    if (!pages.has(url)) throw new Error("missing");
    return pages.get(url);
  });
  assert.equal(result.count, 2);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].files.length, 1);
  assert.deepEqual(result.unavailable, [`${base}/post/789`]);
  assert.equal(calls.filter((url) => url === base).length, 1);
  assert.equal(extractPost(detail([file]), post).files[0].url, file.split("?")[0]);
  assert.deepEqual(authorLinks(list([link(post, true)]), author).posts, [post]);
});

test("rejects incomplete pagination, login pages, changing counts and respects cancellation", async () => {
  await assert.rejects(collectAuthor(author, async (url) => {
    if (url !== base) throw new Error("page failed");
    return list([link(`${base}?o=50`)]);
  }), /page failed/);
  await assert.rejects(collectAuthor(author, async () => ({ querySelector: () => null })), /page-unavailable/);
  await assert.rejects(collectAuthor(author, async () => list([link(post, true)], 2)), /pages-incomplete/);
  await assert.rejects(collectAuthor(author, async (url) => list([link(`${base}?o=50`)], url === base ? 2 : 3)), /author-changed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collectAuthor(author, async () => list([]), { signal: controller.signal }), /cancelled/);
});

test("a post with no archive or an unsupported attachment never claims all files were identified", () => {
  assert.equal(extractPost(detail([]), post).unavailable, true);
  const partial = extractPost(detail([file, "https://img.pawchive.pw/thumbnail/test.jpg"]), post);
  assert.equal(partial.files.length, 1);
  assert.equal(partial.unavailable, true);
  assert.equal(extractPost(detail([file], "wrong-post"), post), null);
});

test("attachment collection runs at most three fetches and can abort midway", async () => {
  let active = 0, maximum = 0;
  const ids = ["1", "2", "3", "4", "5", "6", "7"];
  const result = await collectAuthor(author, async (url) => {
    if (url === base) return list(ids.map((id) => link(`${base}/post/${id}`, true)), ids.length);
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return detail([file], url.split("/").at(-1));
  });
  assert.equal(maximum, 3);
  assert.equal(result.posts.length, 7);
  const controller = new AbortController();
  await assert.rejects(collectAuthor(author, async (url) => {
    if (url === base) return list([link(post, true)]);
    controller.abort();
    throw new Error("aborted");
  }, { signal: controller.signal }), /cancelled/);
});

test("messages are bound to the extension, top frame and current author/post", () => {
  const sender = { id: "utils", frameId: 0, tab: { id: 1 }, url: base };
  const message = { ...author, type: "utils.pawchive.submit", posts: [{ ...author, postId: "456", files: [] }] };
  assert.equal(validMessage(message, sender, "utils"), true);
  for (const override of [{ id: "other" }, { frameId: 1 }, { tab: null }, { url: "https://evil.test/" }, { url: `${base}/post/789` }]) {
    assert.equal(validMessage(message, { ...sender, ...override }, "utils"), false);
  }
  assert.equal(validMessage({ ...message, authorId: "other" }, sender, "utils"), false);
  assert.equal(validMessage({ ...message, posts: [{ ...author, postId: "../bad" }] }, sender, "utils"), false);
  assert.equal(validMessage({ ...message, postId: "456" }, { ...sender, url: post }, "utils"), true);
});
