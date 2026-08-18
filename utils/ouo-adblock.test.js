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

const ouoHosts = ["ouo.io", "ouo.press"];

test("manifest registers ouo.io host permissions and content scripts", () => {
  for (const host of ouoHosts) {
    assert.ok(
      manifest.host_permissions?.some((p) => p.includes(host)),
      `must include ${host} host permission`,
    );
  }

  const ouoEntries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.some((m) => m.includes("ouo.io")),
  );
  assert.equal(ouoEntries.length, 2, "must have MAIN and ISOLATED content scripts for ouo.io");

  const main = ouoEntries.find((entry) => entry.world === "MAIN");
  const isolated = ouoEntries.find((entry) => entry.world === "ISOLATED");
  assert.ok(main?.js?.includes("ouo-adblock-page.js"), "MAIN world must load ouo-adblock-page.js");
  assert.ok(isolated?.js?.includes("ouo-adblock.js"), "ISOLATED world must load ouo-adblock.js");
  assert.ok(isolated?.css?.includes("ouo-adblock.css"), "ISOLATED world must load ouo-adblock.css");
  assert.ok(
    ouoEntries.every((entry) => entry.matches?.some((m) => m.includes("ouo.press"))),
    "content scripts must also match ouo.press",
  );
});

test("DNR rules block ouo.io ad networks", () => {
  const filters = dnrRules.map((rule) => rule.condition.urlFilter);
  for (const domain of [
    "popcash.net",
    "onclckinpg.com",
    "onclckbnr.com",
    "onclckmn.com",
    "onclckbn.net",
    "pubadx.one",
    "cuplikenominee.com",
    "excavatenearbywand.com",
  ]) {
    assert.ok(
      filters.some((filter) => filter.includes(domain)),
      `must block ${domain}`,
    );
  }
  assert.equal(
    filters.some((filter) => filter.includes("adsco.re") || filter.includes("challenges.cloudflare")),
    false,
    "must not block Adscore or Cloudflare Turnstile",
  );
});

const runPageScript = (sandboxExtras = {}) => {
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
    ...sandboxExtras,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read("ouo-adblock-page.js"), sandbox);
  return { sandbox, opened, getWritten: () => written };
};

test("page-world script blocks ad popunders but keeps same-site opens", () => {
  const { sandbox, opened } = runPageScript();
  assert.equal(sandbox.window.open("https://cdn.popcash.net/pop"), null);
  assert.equal(sandbox.window.open("https://bid.onclckbn.net/go"), null);
  assert.equal(sandbox.window.open("https://platform.pubadx.one/ad"), null);
  assert.equal(sandbox.window.open("https://ads.example/path.ouo.io"), null);
  assert.equal(opened.length, 0);

  const kept = sandbox.window.open("https://ouo.io/go/8VW7Xi");
  assert.equal(kept?.url, "https://ouo.io/go/8VW7Xi");
});

test("page-world script intercepts ad document.write calls", () => {
  const { sandbox, getWritten } = runPageScript();
  sandbox.document.write('<script src="//cdn.popcash.net/show.js"></script>');
  sandbox.document.write('<script src="https://js.onclckmn.com/static/onclicka.js"></script>');
  assert.equal(getWritten(), "");
  sandbox.document.write("<b>Get Link</b>");
  assert.equal(getWritten(), "<b>Get Link</b>");
});

const runIsolatedScript = ({ pathname = "/8VW7Xi", ads = [], token = "tok", href = "https://ouo.io/8VW7Xi" } = {}) => {
  const removed = [];
  const timers = [];
  const btn = {
    id: "btn-main",
    disabled: false,
    clicked: 0,
    dataset: {},
    className: "btn btn-main",
    click() {
      this.clicked += 1;
    },
  };
  const tokenEl = { value: token };
  const nodes = ads.map((selectorHint) => {
    const el = {
      tagName: selectorHint.tagName ?? "DIV",
      selectorHint,
      removed: false,
      remove() {
        this.removed = true;
        removed.push(this);
      },
    };
    return el;
  });
  const document = {
    getElementById: (id) => (id === "btn-main" ? btn : null),
    querySelector: (sel) => {
      if (String(sel).includes("cf-turnstile-response")) {
        return token == null ? null : tokenEl;
      }
      return null;
    },
    querySelectorAll: (sel) => nodes.filter((node) => node.selectorHint.selectors.includes(sel)),
    documentElement: {},
    addEventListener() {},
  };
  const sandbox = {
    document,
    window: {
      addEventListener() {},
      location: { pathname, href, hostname: "ouo.io" },
    },
    MutationObserver: class {
      constructor(cb) {
        sandbox.observerCb = cb;
      }
      observe() {}
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval() {},
    location: { pathname, href, hostname: "ouo.io" },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(read("ouo-adblock.js"), sandbox);
  return { btn, nodes, removed, observerCb: sandbox.observerCb, flush: () => timers.splice(0).forEach((fn) => fn()) };
};

test("isolated script removes offer overlay and ad banners", () => {
  const offer = { tagName: "IFRAME", selectors: ['iframe[title="offer"]'] };
  const banner = { tagName: "DIV", selectors: ["[data-banner-id]"] };
  const { nodes } = runIsolatedScript({ ads: [offer, banner] });
  assert.equal(nodes.every((node) => node.removed), true);
});

test("isolated script clicks Get Link on a gate page once Turnstile is ready", () => {
  const { btn, flush } = runIsolatedScript({ token: "cf-ok" });
  flush();
  assert.equal(btn.clicked, 1);
  flush();
  assert.equal(btn.clicked, 1, "must click only once");
});

test("isolated script does not click on the marketing homepage", () => {
  const { btn, flush } = runIsolatedScript({ pathname: "/", href: "https://ouo.io/" });
  flush();
  assert.equal(btn.clicked, 0);
});

test("isolated script waits for Turnstile instead of force-clicking an empty token", () => {
  const { btn, flush } = runIsolatedScript({ token: "" });
  flush();
  assert.equal(btn.clicked, 0);
});

test("isolated script waits until the Turnstile field exists", () => {
  const { btn, flush } = runIsolatedScript({ token: null });
  flush();
  assert.equal(btn.clicked, 0);
});

test("isolated script removes a matching node injected as an addedNode", () => {
  const { observerCb } = runIsolatedScript();
  assert.equal(typeof observerCb, "function");
  const added = {
    nodeType: 1,
    tagName: "IFRAME",
    removed: false,
    matches: (sel) => sel === 'iframe[title="offer"]',
    querySelectorAll: () => [],
    remove() {
      this.removed = true;
    },
  };
  observerCb([{ addedNodes: [added] }]);
  assert.equal(added.removed, true);
});

test("ouo-adblock.css hides offer overlays and pubadx banners", () => {
  const css = read("ouo-adblock.css");
  assert.ok(css.includes('iframe[title="offer"]'), "must hide offer iframe");
  assert.ok(css.includes("[data-banner-id]"), "must hide pubadx/onclck banners");
  assert.ok(css.includes("onclck") || css.includes("pubadx"), "must hide known ad iframe hosts");
  assert.ok(css.includes("display: none !important"), "must enforce display: none !important");
});
