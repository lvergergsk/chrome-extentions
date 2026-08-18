import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const dnrRules = JSON.parse(read("rules/adblock.json"));

test("manifest registers orangepix.is host permissions and content scripts", () => {
  assert.ok(
    manifest.host_permissions?.some((p) => p.includes("orangepix.is")),
    "must include orangepix.is host permission",
  );

  const entries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.some((m) => m.includes("orangepix.is")),
  );
  assert.equal(entries.length, 2, "must have MAIN and ISOLATED content scripts for orangepix.is");

  const main = entries.find((entry) => entry.world === "MAIN");
  const isolated = entries.find((entry) => entry.world === "ISOLATED");
  assert.ok(main?.js?.includes("orangepix-adblock-page.js"), "MAIN world must load orangepix-adblock-page.js");
  assert.ok(isolated?.js?.includes("orangepix-adblock.js"), "ISOLATED world must load orangepix-adblock.js");
  assert.ok(isolated?.css?.includes("orangepix-adblock.css"), "ISOLATED world must load orangepix-adblock.css");
});

test("DNR rules block orangepix ad networks and first-party ad paths", () => {
  const filters = dnrRules.map((rule) => rule.condition.urlFilter);
  for (const domain of [
    "aagm.link",
    "bbwafx.com",
    "vexlira.com",
    "miserly-wrap.com",
    "armsbroodelusive.com",
    "new-split.com",
    "orangepix.is/htsrc.js",
    "orangepix.is/b_pics/",
    "orangepix.is/istrp/",
  ]) {
    assert.ok(
      filters.some((filter) => filter.includes(domain)),
      `must block ${domain}`,
    );
  }
  assert.equal(
    filters.some((filter) => filter.includes("orangepix.is/images/")),
    false,
    "must not block actual image files",
  );
});

const runPageScript = () => {
  const opened = [];
  let written = "";
  const sandbox = {
    window: {
      open(url, ...rest) {
        opened.push(url);
        return { url, rest };
      },
    },
    document: {
      write(val) {
        written += val;
      },
      writeln(val) {
        written += val;
      },
    },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read("orangepix-adblock-page.js"), sandbox);
  return { sandbox, opened, getWritten: () => written };
};

test("page-world script blocks ad popunders but keeps orangepix opens", () => {
  const { sandbox, opened } = runPageScript();
  assert.equal(sandbox.window.open("https://new-split.com/pop"), null);
  assert.equal(sandbox.window.open("https://t.aagm.link/offer"), null);
  assert.equal(sandbox.window.open("https://mks98.com/link2"), null);
  assert.equal(opened.length, 0);

  const kept = sandbox.window.open("https://orangepix.is/image/6la1c");
  assert.equal(kept?.url, "https://orangepix.is/image/6la1c");
});

test("page-world script intercepts ad document.write calls", () => {
  const { sandbox, getWritten } = runPageScript();
  sandbox.document.write('<script src="https://miserly-wrap.com/ad.js"></script>');
  sandbox.document.write('<script src="https://armsbroodelusive.com/invoke.js"></script>');
  assert.equal(getWritten(), "");
  sandbox.document.write('<img class="media" src="/images/ok.jpg">');
  assert.equal(getWritten(), '<img class="media" src="/images/ok.jpg">');
});

test("isolated script removes banner row and affiliate links", () => {
  const nodes = [
    { tagName: "DIV", selectors: [".bnrs"], removed: false, remove() { this.removed = true; } },
    { tagName: "A", selectors: ['a[href*="aagm.link"]'], removed: false, remove() { this.removed = true; } },
    { tagName: "A", selectors: ['a[href*="vexlira.com"]'], removed: false, remove() { this.removed = true; } },
    { tagName: "DIV", selectors: ["#ageOverlay"], removed: false, remove() { this.removed = true; } },
  ];
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel) => nodes.filter((node) => node.selectors.includes(sel)),
    documentElement: { dataset: {} },
    addEventListener() {},
  };
  const sandbox = {
    document,
    window: { addEventListener() {}, location: { hostname: "orangepix.is" } },
    MutationObserver: class {
      constructor(cb) {
        sandbox.observerCb = cb;
      }
      observe() {}
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(read("orangepix-adblock.js"), sandbox);
  assert.equal(nodes.every((node) => node.removed), true);
  assert.equal(document.documentElement.dataset.utilsOrangepix, "1");

  const added = {
    nodeType: 1,
    tagName: "DIV",
    removed: false,
    matches: (sel) => sel === "#ageOverlay",
    querySelectorAll: () => [],
    remove() {
      this.removed = true;
    },
  };
  sandbox.observerCb([{ addedNodes: [added] }]);
  assert.equal(added.removed, true);
});

test("orangepix-adblock.css hides banner row and affiliate ads", () => {
  const css = read("orangepix-adblock.css");
  assert.ok(css.includes(".bnrs"), "must hide .bnrs");
  assert.ok(css.includes(".bnr"), "must hide .bnr");
  assert.ok(css.includes("aagm.link"), "must hide aagm affiliate links");
  assert.ok(css.includes("vexlira.com"), "must hide vexlira banners");
  assert.ok(css.includes("#ageOverlay"), "must hide the age overlay");
  assert.ok(css.includes("display: none !important"), "must enforce display: none !important");
});
