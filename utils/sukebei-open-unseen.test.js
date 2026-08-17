import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

const loadApi = () => {
  const sandbox = { URL };
  vm.createContext(sandbox);
  vm.runInContext(read("sukebei-open-unseen.js"), sandbox);
  return sandbox.UtilsSukebeiOpenUnseen;
};

test("isolated Sukebei entry loads the open-unseen script", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.permissions?.includes("history"), "must request history to match visited links");
  const isolated = (manifest.content_scripts ?? []).find(
    (entry) =>
      entry.world === "ISOLATED" &&
      entry.matches?.some((match) => match.includes("sukebei.nyaa.si")),
  );
  assert.ok(isolated.js?.includes("sukebei-open-unseen.js"));
});

test("collectUnflaggedViewUrls skips red rows and keeps view links", () => {
  const { collectUnflaggedViewUrls, INTERVAL_MS } = loadApi();
  assert.equal(INTERVAL_MS, 3000);

  const flagged = {
    classList: { contains: (name) => name === "utils-sukebei-flag" },
    querySelector: () => ({ getAttribute: () => "/view/red" }),
  };
  const plain = {
    classList: { contains: () => false },
    querySelector: (sel) =>
      sel.includes("/view/") ? { getAttribute: () => "/view/ok" } : null,
  };
  const table = {
    querySelectorAll: () => [flagged, plain],
  };
  const root = {
    querySelector: (sel) => (sel === "table.torrent-list" ? table : null),
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(collectUnflaggedViewUrls(root, "https://sukebei.nyaa.si"))),
    ["https://sukebei.nyaa.si/view/ok"],
  );
});

test("markSeenUrls paints matching title links gray", () => {
  const { markSeenUrls, SEEN_CLASS } = loadApi();
  const added = [];
  const title = {
    getAttribute: () => "/view/ok",
    classList: { add: (name) => added.push(name) },
  };
  const table = {
    querySelectorAll: () => [title],
  };
  const root = {
    querySelector: (sel) => (sel === "table.torrent-list" ? table : null),
  };
  assert.equal(
    markSeenUrls(root, "https://sukebei.nyaa.si", ["https://sukebei.nyaa.si/view/ok"]),
    1,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(added)), [SEEN_CLASS]);
});

test("CSS marks opened titles gray", () => {
  const css = read("sukebei-adblock.css");
  assert.ok(css.includes(".utils-sukebei-seen"));
  assert.match(css, /\.utils-sukebei-seen[\s\S]*#888/);
});
