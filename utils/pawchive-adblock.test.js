import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

test("Pawchive blocks its ad network and hides its ad slots", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const rules = JSON.parse(read("rules/adblock.json"));
  const matches = ["*://pawchive.pw/*", "*://*.pawchive.pw/*"];

  for (const match of matches) {
    assert.ok(manifest.host_permissions.includes(match));
  }
  assert.ok(manifest.content_scripts.some((entry) =>
    matches.every((match) => entry.matches.includes(match)) &&
    entry.css?.includes("pawchive-adblock.css"),
  ));

  assert.ok(rules.some((rule) =>
    rule.condition.urlFilter === "||phonydepth.com^" &&
    rule.condition.initiatorDomains?.includes("pawchive.pw"),
  ));
  const affiliate = rules.find((rule) => rule.condition.urlFilter === "||theporndude.com^");
  assert.ok(affiliate.condition.initiatorDomains.includes("pawchive.pw"));

  const css = read("pawchive-adblock.css");
  assert.match(css, /\.ad-container\s*,/);
  assert.match(css, /a\[href\*="theporndude\.com"\]/);
  assert.match(css, /display:\s*none\s*!important/);
});
