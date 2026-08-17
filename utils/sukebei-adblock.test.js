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

test("manifest registers Sukebei host permissions, DNR rules and content scripts", () => {
  assert.ok(
    manifest.host_permissions?.some((p) => p.includes("sukebei.nyaa.si")),
    "must include sukebei.nyaa.si host permission",
  );
  assert.ok(
    manifest.permissions?.includes("declarativeNetRequest"),
    "must request declarativeNetRequest permission",
  );
  assert.ok(
    manifest.declarative_net_request?.rule_resources?.some((r) => r.path === "rules/adblock.json"),
    "must declare rules/adblock.json in declarative_net_request",
  );

  const sukebeiEntries = (manifest.content_scripts ?? []).filter((entry) =>
    entry.matches?.some((m) => m.includes("sukebei.nyaa.si")),
  );
  assert.equal(sukebeiEntries.length, 2, "must have MAIN and ISOLATED content scripts for Sukebei");
});

test("DNR rules block known ad domains with valid rule definitions", () => {
  assert.ok(Array.isArray(dnrRules) && dnrRules.length >= 5, "rules must have full coverage");
  for (const rule of dnrRules) {
    assert.equal(rule.action?.type, "block", `rule ${rule.id} action must be block`);
    assert.ok(typeof rule.id === "number", `rule ${rule.id} id must be number`);
    assert.ok(typeof rule.condition?.urlFilter === "string", `rule ${rule.id} urlFilter must be string`);
  }
  const filters = dnrRules.map((r) => r.condition.urlFilter);
  assert.ok(filters.some((f) => f.includes("tsyndicate.com")), "must block tsyndicate.com");
  assert.ok(filters.some((f) => f.includes("trafficstars.com")), "must block trafficstars.com");
  assert.ok(filters.some((f) => f.includes("exoclick.com")), "must block exoclick.com");
});

test("page-world script safely stubs TSVideoInstantMessage, TSOutstreamVideo and other TS SDKs", () => {
  const code = read("sukebei-adblock-page.js");
  const sandbox = {
    window: {},
    document: {
      write: () => {},
      writeln: () => {},
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  assert.equal(typeof sandbox.window.TSVideoInstantMessage, "function");
  assert.equal(typeof sandbox.window.TSOutstreamVideo, "function");
  assert.equal(typeof sandbox.window.TSPopunder, "function");
  assert.equal(typeof sandbox.window.TSBanner, "function");
  assert.doesNotThrow(() => sandbox.window.TSVideoInstantMessage({ spot: "123" }));
  assert.doesNotThrow(() => sandbox.window.TSOutstreamVideo({ spot: "123" }));
});

test("page-world script intercepts ad document.write calls", () => {
  const code = read("sukebei-adblock-page.js");
  let written = "";
  const sandbox = {
    window: {},
    document: {
      write: (val) => {
        written += val;
      },
      writeln: (val) => {
        written += val;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // Ad script write should be discarded
  sandbox.document.write('<script src="//cdn.tsyndicate.com/sdk/v1/ms.js"></script>');
  assert.equal(written, "");

  // Normal write should pass through
  sandbox.document.write("<b>Hello World</b>");
  assert.equal(written, "<b>Hello World</b>");
});

test("sukebei-adblock.css includes selectors for known ad containers and sponsor links", () => {
  const css = read("sukebei-adblock.css");
  assert.ok(css.includes("#e71bf691-4eb4-453f-8f11-6f40280c18f6"), "must hide top banner container");
  assert.ok(css.includes("#ec01fd54-016b-41b4-bec9-b9b93f9b3b77"), "must hide bottom video container");
  assert.ok(css.includes(".ts-outstream-video"), "must hide outstream video class");
  assert.ok(css.includes("theporndude.com"), "must hide sponsor link");
  assert.ok(css.includes("display: none !important"), "must enforce display: none !important");
});
