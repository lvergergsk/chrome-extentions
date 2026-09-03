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

test("manifest registers gamebanana.com host permissions and content scripts", () => {
  assert.ok(
    manifest.host_permissions?.some((p) => p.includes("gamebanana.com")),
    "must include gamebanana.com host permission",
  );

  const entries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.some((m) => m.includes("gamebanana.com")),
  );
  assert.equal(entries.length, 2, "must have MAIN and ISOLATED content scripts for gamebanana.com");

  const main = entries.find((entry) => entry.world === "MAIN");
  const isolated = entries.find((entry) => entry.world === "ISOLATED");
  assert.ok(main?.js?.includes("gamebanana-adblock-page.js"), "MAIN world must load gamebanana-adblock-page.js");
  assert.ok(isolated?.js?.includes("gamebanana-adblock.js"), "ISOLATED world must load gamebanana-adblock.js");
  assert.ok(isolated?.css?.includes("gamebanana-adblock.css"), "ISOLATED world must load gamebanana-adblock.css");
});

test("DNR rules block the gamebanana ad stack and stay scoped to gamebanana", () => {
  const gbRules = dnrRules.filter((rule) => rule.condition.initiatorDomains?.includes("gamebanana.com"));
  const filters = gbRules.map((rule) => rule.condition.urlFilter);

  for (const domain of [
    "intergient.com",
    "playwire.com",
    "googlesyndication.com",
    "doubleclick.net",
    "btloader.com",
    "ad-delivery.net",
    "amazon-adsystem.com",
    "rubiconproject.com",
    "bounceexchange.com",
    "crwdcntrl.net",
  ]) {
    assert.ok(
      filters.some((filter) => filter.includes(domain)),
      `must block ${domain} on gamebanana`,
    );
  }

  // ajax.googleapis.com serves jQuery for the site itself; only the IMA ad SDK
  // subdomain may be blocked.
  assert.equal(
    filters.some((filter) => filter === "||googleapis.com^"),
    false,
    "must not block googleapis.com wholesale",
  );

  for (const rule of gbRules) {
    assert.deepEqual(rule.condition.initiatorDomains, ["gamebanana.com"], "gamebanana rules must not leak to other sites");
  }

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
  vm.runInContext(read("gamebanana-adblock-page.js"), sandbox);
  return { sandbox, opened, getWritten: () => written };
};

test("page-world script blocks ad popunders but keeps real outbound links", () => {
  const { sandbox, opened } = runPageScript();
  assert.equal(sandbox.window.open("https://cdn.intergient.com/pop"), null);
  assert.equal(sandbox.window.open("https://securepubads.g.doubleclick.net/x"), null);
  assert.equal(sandbox.window.open("https://api.btloader.com/promo"), null);
  assert.equal(sandbox.window.open(new URL("https://cdn.intergient.com/x")), null);
  assert.equal(opened.length, 0);

  // gamebanana links out to mirrors and author pages; those must still open.
  for (const url of [
    "https://gamebanana.com/mods/537961",
    "https://github.com/some/mod/releases",
    "https://www.mediafire.com/file/abc",
    "https://notplaywire.com/",
  ]) {
    assert.equal(sandbox.window.open(url)?.url, url, `${url} must still open`);
  }
});

test("page-world script intercepts ad document.write calls", () => {
  const { sandbox, getWritten } = runPageScript();
  sandbox.document.write('<script src="https://cdn.intergient.com/ramp_core.js"></script>');
  sandbox.document.writeln('<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>');
  assert.equal(getWritten(), "");
  sandbox.document.write('<img class="Screenshot" src="https://images.gamebanana.com/img/ss/mods/1.jpg">');
  sandbox.document.write('<img src="https://images.gamebanana.com/img/ss/mods/1.jpg?ref=playwire.com">');
  assert.equal(
    getWritten(),
    '<img class="Screenshot" src="https://images.gamebanana.com/img/ss/mods/1.jpg"><img src="https://images.gamebanana.com/img/ss/mods/1.jpg?ref=playwire.com">',
  );
});

test("isolated script removes playwire rails and the in-grid slot", () => {
  const nodes = [
    { tagName: "DIV", selectors: [".pw-tag"], removed: false, remove() { this.removed = true; } },
    { tagName: "DIV", selectors: ["#pw-oop-flex_container"], removed: false, remove() { this.removed = true; } },
    { tagName: "DIV", selectors: [".InGridPlaceholder"], removed: false, remove() { this.removed = true; } },
    { tagName: "DIV", selectors: ['[id^="google_ads_iframe"]'], removed: false, remove() { this.removed = true; } },
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
    window: { addEventListener() {}, location: { hostname: "gamebanana.com" } },
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
  vm.runInContext(read("gamebanana-adblock.js"), sandbox);
  assert.equal(nodes.every((node) => node.removed), true);
  assert.equal(document.documentElement.dataset.utilsGamebanana, "1");

  const added = {
    nodeType: 1,
    tagName: "DIV",
    removed: false,
    matches: (sel) => sel === "#pwAdContainer",
    querySelectorAll: () => [],
    remove() {
      this.removed = true;
    },
  };
  sandbox.observerCb([{ addedNodes: [added] }]);
  assert.equal(added.removed, true);
});

test("ad-blocker bait nodes are left untouched", () => {
  const css = read("gamebanana-adblock.css");
  const js = read("gamebanana-adblock.js");
  for (const bait of ["#adBanner", "adLeaderboard", "ad_row", "adbannertop", "boxad", "contentAd"]) {
    assert.equal(css.includes(`${bait},`) || css.includes(`${bait} {`), false, `css must not hide bait ${bait}`);
    assert.equal(js.includes(`"${bait}"`), false, `js must not remove bait ${bait}`);
  }
});

test("gamebanana-adblock.css hides the ad slots", () => {
  const css = read("gamebanana-adblock.css");
  assert.ok(css.includes(".pw-tag"), "must hide playwire tags");
  assert.ok(css.includes("#pwAdContainer"), "must hide the in-grid ad container");
  assert.ok(css.includes(".InGridPlaceholder"), "must hide the empty in-grid cell");
  assert.ok(css.includes('[id^="google_ads_iframe"]'), "must hide GPT containers");
  assert.ok(css.includes("display: none !important"), "must enforce display: none !important");
});
