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

test("manifest registers kemono.cr host permissions and content scripts", () => {
  assert.ok(
    manifest.host_permissions?.some((p) => p.includes("kemono.cr")),
    "must include kemono.cr host permission",
  );

  const entries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.some((m) => m.includes("kemono.cr")),
  );
  assert.equal(entries.length, 2, "must have MAIN and ISOLATED content scripts for kemono.cr");

  const main = entries.find((entry) => entry.world === "MAIN");
  const isolated = entries.find((entry) => entry.world === "ISOLATED");
  assert.ok(main?.js?.includes("kemono-adblock-page.js"), "MAIN world must load kemono-adblock-page.js");
  assert.ok(isolated?.js?.includes("kemono-adblock.js"), "ISOLATED world must load kemono-adblock.js");
  assert.ok(isolated?.css?.includes("kemono-adblock.css"), "ISOLATED world must load kemono-adblock.css");
});

test("DNR rules block kemono ad networks without touching the site API", () => {
  const filters = dnrRules.map((rule) => rule.condition.urlFilter);

  for (const domain of ["tsyndicate.com", "trafficstars.com", "mnaspm.com", "magsrv.com"]) {
    assert.ok(
      filters.some((filter) => filter.includes(domain)),
      `must block ${domain}`,
    );
  }

  const porndude = dnrRules.find((rule) => rule.condition.urlFilter.includes("theporndude.com"));
  assert.ok(porndude, "must keep theporndude.com block");
  assert.ok(
    porndude.condition.initiatorDomains?.includes("kemono.cr"),
    "theporndude.com block must include kemono.cr as initiator",
  );

  assert.equal(
    filters.some((filter) => filter.includes("kemono.cr/api")),
    false,
    "must not block kemono.cr API paths",
  );
  assert.equal(new Set(dnrRules.map((rule) => rule.id)).size, dnrRules.length, "rule ids must be unique");
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
  vm.runInContext(read("kemono-adblock-page.js"), sandbox);
  return { sandbox, opened, getWritten: () => written };
};

test("page-world script blocks ad popunders but keeps creator and site links", () => {
  const { sandbox, opened } = runPageScript();
  assert.equal(sandbox.window.open("https://cdn.tsyndicate.com/sdk/v1/ms.js"), null);
  assert.equal(sandbox.window.open("https://go.mnaspm.com/click"), null);
  assert.equal(sandbox.window.open("https://s.magsrv.com/v1/api.php"), null);
  assert.equal(sandbox.window.open("https://www.theporndude.com/"), null);
  assert.equal(sandbox.window.open(new URL("https://cdn.tsyndicate.com/x")), null);
  assert.equal(opened.length, 0);

  for (const url of [
    "https://kemono.cr/patreon/user/12345",
    "https://kemono.cr/api/v1/posts",
    "https://www.patreon.com/posts/1",
    "https://mega.nz/file/abc",
    "https://nottsyndicate.com/",
  ]) {
    assert.equal(sandbox.window.open(url)?.url, url, `${url} must still open`);
  }
});

test("page-world script intercepts ad document.write calls", () => {
  const { sandbox, getWritten } = runPageScript();
  sandbox.document.write('<script src="https://cdn.tsyndicate.com/sdk/v1/ms.js"></script>');
  sandbox.document.writeln('<script src="https://go.mnaspm.com/ad.js"></script>');
  assert.equal(getWritten(), "");
  sandbox.document.write('<img class="post-card__image" src="https://img.kemono.cr/thumbnail.jpg">');
  sandbox.document.write('<img src="https://img.kemono.cr/x.jpg?ref=theporndude.com">');
  assert.equal(
    getWritten(),
    '<img class="post-card__image" src="https://img.kemono.cr/thumbnail.jpg"><img src="https://img.kemono.cr/x.jpg?ref=theporndude.com">',
  );
});

test("isolated script removes ad containers and injected slots", () => {
  const nodes = [
    { tagName: "DIV", selectors: [".ad-container"], removed: false, remove() { this.removed = true; } },
    { tagName: "ASIDE", selectors: ["#ad-banner"], removed: false, remove() { this.removed = true; } },
    {
      tagName: "A",
      selectors: [".sidebar-extra-style.global-sidebar-entry-item"],
      removed: false,
      remove() { this.removed = true; },
    },
    { tagName: "A", selectors: ['a[href*="theporndude.com"]'], removed: false, remove() { this.removed = true; } },
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
    window: { addEventListener() {}, location: { hostname: "kemono.cr" } },
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
  vm.runInContext(read("kemono-adblock.js"), sandbox);
  assert.equal(nodes.every((node) => node.removed), true);
  assert.equal(document.documentElement.dataset.utilsKemono, "1");

  const added = {
    nodeType: 1,
    tagName: "DIV",
    removed: false,
    matches: (sel) => sel === ".ad-container",
    querySelectorAll: () => [],
    remove() {
      this.removed = true;
    },
  };
  sandbox.observerCb([{ addedNodes: [added] }]);
  assert.equal(added.removed, true);
});

test("kemono-adblock.css hides the ad slots", () => {
  const css = read("kemono-adblock.css");
  assert.ok(css.includes(".ad-container"), "must hide .ad-container");
  assert.ok(css.includes("#ad-banner"), "must hide #ad-banner");
  assert.ok(css.includes(".sidebar-extra-style.global-sidebar-entry-item"), "must hide sidebar ad extras");
  assert.ok(css.includes("theporndude.com"), "must hide theporndude links");
  assert.ok(css.includes("display: none !important"), "must enforce display: none !important");
});
