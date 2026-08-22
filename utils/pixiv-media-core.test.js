import assert from "node:assert/strict";
import test from "node:test";
import "./pixiv-media-core.js";

const {
  BOOKMARK_ENDPOINT,
  bookmarkPayload,
  csrfToken,
  csrfTokenFromLegacyMeta,
  csrfTokenFromNextData,
  dedupeUrls,
  domOriginalUrls,
  downloadFilename,
  illustEndpoint,
  illustIdFrom,
  illustPageIndex,
  isBookmarked,
  isIllustId,
  isPixivImageUrl,
  isUgoira,
  mainIllustHosts,
  mapLimited,
  originalUrls,
  pagesEndpoint,
  thumbnailHost,
  thumbnailLinks,
} = globalThis.UtilsPixivMedia;

const original = (id, page, extension = "jpg") =>
  `https://i.pximg.net/img-original/img/2026/08/22/22/58/01/${id}_p${page}.${extension}`;

const node = (attributes = {}, extras = {}) => ({
  getAttribute: (name) => attributes[name] ?? null,
  querySelector: () => null,
  append() {},
  ...extras,
});

const root = (bySelector) => ({
  querySelectorAll: (selector) => bySelector[selector] ?? [],
  querySelector: (selector) => (bySelector[selector] ?? [])[0] ?? null,
});

test("isPixivImageUrl only allows the pixiv image host over https", () => {
  assert.equal(isPixivImageUrl(original("148755888", 0)), true);
  assert.equal(isPixivImageUrl("http://i.pximg.net/img-original/a_p0.jpg"), false);
  assert.equal(isPixivImageUrl("https://evil.example/img-original/a_p0.jpg"), false);
  assert.equal(isPixivImageUrl("blob:https://www.pixiv.net/123"), false);
});

test("illustIdFrom reads the id from every artwork link shape", () => {
  assert.equal(illustIdFrom("/artworks/148755888"), "148755888");
  assert.equal(illustIdFrom("/en/artworks/148755888"), "148755888");
  assert.equal(illustIdFrom("https://www.pixiv.net/artworks/148755888?lang=ja"), "148755888");
  assert.equal(illustIdFrom("/users/62342846"), null);
  assert.equal(illustIdFrom(null), null);
});

test("isIllustId rejects anything that is not a bare number", () => {
  assert.equal(isIllustId("148755888"), true);
  assert.equal(isIllustId("../settings"), false);
  assert.equal(isIllustId(null), false);
});

test("endpoints stay on pixiv and encode the id", () => {
  assert.equal(illustEndpoint("148755888"), "https://www.pixiv.net/ajax/illust/148755888?lang=ja");
  assert.equal(pagesEndpoint("148755888"), "https://www.pixiv.net/ajax/illust/148755888/pages?lang=ja");
});

test("illustPageIndex reads pixiv's own page numbering", () => {
  assert.equal(illustPageIndex(original("148755888", 0)), 0);
  assert.equal(illustPageIndex("https://i.pximg.net/img-master/img/a/148755888_p12_master1200.jpg"), 12);
  assert.equal(illustPageIndex("https://i.pximg.net/img-original/img/a/plain.jpg"), null);
});

test("downloadFilename keeps the pixiv page number and the real extension", () => {
  assert.equal(downloadFilename("148755888", 0, original("148755888", 0)), "pixiv-148755888-p0.jpg");
  assert.equal(downloadFilename("148755888", 1, original("148755888", 3, "png")), "pixiv-148755888-p3.png");
  assert.equal(downloadFilename("148755888", 2, original("148755888", 4, "jpeg")), "pixiv-148755888-p4.jpg");
});

test("downloadFilename falls back for an unusable id, index or extension", () => {
  assert.equal(downloadFilename("../etc", 0, "https://i.pximg.net/img-original/img/a/b.tar"), "pixiv-etc-p0.jpg");
  assert.equal(downloadFilename(null, 2, "not a url"), "pixiv-pixiv-p2.jpg");
});

test("dedupeUrls drops duplicates and anything off the pixiv image host", () => {
  assert.deepEqual(
    dedupeUrls([original("1", 0), original("1", 0), "https://evil.example/a.jpg", null, original("1", 1)]),
    [original("1", 0), original("1", 1)],
  );
});

test("isBookmarked reads the bookmarkData pixiv already ships in list responses", () => {
  assert.equal(isBookmarked({ bookmarkData: { id: "1", private: false } }), true);
  assert.equal(isBookmarked({ bookmarkData: null }), false);
  assert.equal(isBookmarked({}), false);
  assert.equal(isBookmarked(null), false);
});

test("bookmarkPayload posts a public bookmark and never invents tags or a comment", () => {
  assert.equal(BOOKMARK_ENDPOINT, "https://www.pixiv.net/ajax/illusts/bookmarks/add");
  assert.deepEqual(bookmarkPayload(148755888), {
    illust_id: "148755888",
    restrict: 0,
    comment: "",
    tags: [],
  });
  assert.equal(bookmarkPayload("1", 1).restrict, 1);
  assert.equal(bookmarkPayload("1", "nonsense").restrict, 0);
});

test("mapLimited keeps order, covers every item and never exceeds the limit", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  let running = 0;
  let peak = 0;
  const results = await mapLimited(items, 3, async (item, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, item % 3));
    running -= 1;
    return `${index}:${item}`;
  });
  assert.deepEqual(results, ["0:1", "1:2", "2:3", "3:4", "4:5", "5:6", "6:7"]);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the limit`);
});

test("mapLimited tolerates an empty list and a nonsense limit", async () => {
  assert.deepEqual(await mapLimited([], 3, async () => "x"), []);
  assert.deepEqual(await mapLimited(null, 3, async () => "x"), []);
  assert.deepEqual(await mapLimited([1, 2], 0, async (item) => item * 2), [2, 4]);
});

test("isUgoira only matches illustType 2", () => {
  assert.equal(isUgoira({ illustType: 2 }), true);
  assert.equal(isUgoira({ illustType: 0 }), false);
  assert.equal(isUgoira(null), false);
});

test("originalUrls merges the multi-page list with the single-page url", () => {
  const illust = { urls: { original: original("1", 0) } };
  const pages = [{ urls: { original: original("1", 0) } }, { urls: { original: original("1", 1) } }];
  assert.deepEqual(originalUrls(illust, pages), [original("1", 0), original("1", 1)]);
  assert.deepEqual(originalUrls(illust, null), [original("1", 0)]);
  assert.deepEqual(originalUrls({}, null), []);
});

test("csrfTokenFromNextData digs the token out of the nested JSON string", () => {
  const state = JSON.stringify({ api: { token: "0123456789abcdef0123456789abcdef" } });
  const nextData = JSON.stringify({ props: { pageProps: { serverSerializedPreloadedState: state } } });
  assert.equal(csrfTokenFromNextData(nextData), "0123456789abcdef0123456789abcdef");
  assert.equal(csrfTokenFromNextData("{"), null);
  assert.equal(csrfTokenFromNextData(JSON.stringify({ props: {} })), null);
});

test("csrfTokenFromLegacyMeta reads the pre-Next.js meta tag", () => {
  assert.equal(csrfTokenFromLegacyMeta(JSON.stringify({ token: "abc" })), "abc");
  assert.equal(csrfTokenFromLegacyMeta("not json"), null);
});

test("csrfToken prefers __NEXT_DATA__ and falls back to the legacy meta tag", () => {
  const state = JSON.stringify({ api: { token: "next-token" } });
  const nextData = { textContent: JSON.stringify({ props: { pageProps: { serverSerializedPreloadedState: state } } }) };
  assert.equal(csrfToken(root({ "#__NEXT_DATA__": [nextData] })), "next-token");

  const legacy = { content: JSON.stringify({ token: "legacy-token" }) };
  assert.equal(csrfToken(root({ 'meta[name="global-data"], #meta-global-data': [legacy] })), "legacy-token");
  assert.equal(csrfToken(root({})), null);
  assert.equal(csrfToken(null), null);
});

test("thumbnailLinks takes GA4 tiles and image links but not caption links", () => {
  const tile = node({ href: "/artworks/1", "data-ga4-label": "thumbnail_link" });
  const imageLink = node({ href: "/artworks/2" }, { querySelector: () => ({}) });
  const captionLink = node({ href: "/artworks/3" });
  const userLink = node({ href: "/users/4" }, { querySelector: () => ({}) });

  assert.deepEqual(
    thumbnailLinks(
      root({
        'a[data-ga4-label="thumbnail_link"]': [tile],
        'a[href*="/artworks/"]': [tile, imageLink, captionLink, userLink],
      }),
    ),
    [tile, imageLink],
  );
});

test("thumbnailHost uses the sized wrapper for a GA4 tile and the link itself otherwise", () => {
  const wrapper = { append() {} };
  const tile = node({ "data-ga4-label": "thumbnail_link" }, { parentElement: wrapper });
  assert.equal(thumbnailHost(tile), wrapper);

  const row = { append() {} };
  const imageLink = node({}, { parentElement: row });
  assert.equal(thumbnailHost(imageLink), imageLink);
});

test("mainIllustHosts prefers the full-size links and falls back to the image wrapper", () => {
  const link = node({ href: original("1", 0) });
  assert.deepEqual(mainIllustHosts(root({ 'a[href*="i.pximg.net/img-original/"]': [link] })), [link]);

  const wrapper = { append() {} };
  const image = { parentElement: wrapper };
  assert.deepEqual(
    mainIllustHosts(root({ '[role="presentation"] img[src*="i.pximg.net"]': [image] })),
    [wrapper],
  );
});

test("domOriginalUrls reads the artwork page's own full-size links", () => {
  const links = [{ href: original("1", 0) }, { href: original("1", 0) }, { href: "https://evil.example/a.jpg" }];
  assert.deepEqual(domOriginalUrls(root({ 'a[href*="i.pximg.net/img-original/"]': links })), [original("1", 0)]);
});

test("DOM helpers tolerate missing pixiv surfaces", () => {
  assert.deepEqual(thumbnailLinks(null), []);
  assert.deepEqual(mainIllustHosts(null), []);
  assert.deepEqual(domOriginalUrls(null), []);
  assert.equal(thumbnailHost(null), null);
});
