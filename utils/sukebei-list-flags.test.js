import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

const loadApi = () => {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("sukebei-list-flags.js"), sandbox);
  return sandbox.UtilsSukebeiListFlags;
};

test("isolated Sukebei entry loads the list-flag script", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const isolated = (manifest.content_scripts ?? []).find(
    (entry) =>
      entry.world === "ISOLATED" &&
      entry.matches?.some((match) => match.includes("sukebei.nyaa.si")),
  );
  assert.ok(isolated, "must have an isolated Sukebei content script");
  assert.ok(isolated.js?.includes("sukebei-list-flags.js"), "must load sukebei-list-flags.js");
});

test("collectParts paints [AI生成] and アンソロジー only", () => {
  const { collectParts } = loadApi();
  const parts = (text) => JSON.parse(JSON.stringify(collectParts(text)));
  assert.deepEqual(parts("plain title"), [{ text: "plain title", flag: false }]);
  assert.deepEqual(parts("(同人CG集) [AI生成] foo"), [
    { text: "(同人CG集) ", flag: false },
    { text: "[AI生成]", flag: true },
    { text: " foo", flag: false },
  ]);
  assert.deepEqual(parts("作品 アンソロジー vol.2"), [
    { text: "作品 ", flag: false },
    { text: "アンソロジー", flag: true },
    { text: " vol.2", flag: false },
  ]);
  assert.deepEqual(parts("[AI生成] アンソロジー"), [
    { text: "[AI生成]", flag: true },
    { text: " ", flag: false },
    { text: "アンソロジー", flag: true },
  ]);
});

test("list flags stay on Sukebei list pages", () => {
  const { isSukebeiHost, isListPath } = loadApi();
  assert.equal(isSukebeiHost("sukebei.nyaa.si"), true);
  assert.equal(isSukebeiHost("www.sukebei.nyaa.si"), true);
  assert.equal(isSukebeiHost("nyaa.si"), false);
  assert.equal(isListPath("/"), true);
  assert.equal(isListPath("/?q=AI"), true);
  assert.equal(isListPath("/view/4675611"), false);
});

test("sukebei-adblock.css colors list flags red", () => {
  const css = read("sukebei-adblock.css");
  assert.ok(css.includes(".utils-sukebei-flag"), "must style .utils-sukebei-flag");
  assert.match(css, /\.utils-sukebei-flag[\s\S]*color:\s*#ff4d4f/i);
});
