import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));

const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

const manifest = JSON.parse(read("manifest.json"));

const allContentScripts = [
  ...new Set((manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])),
];

test("content scripts stay classic so Chrome 151 can parse them", () => {
  for (const name of allContentScripts) {
    const text = read(name);
    assert.equal(/^\s*import\s/m.test(text), false, `${name} must not use import`);
    assert.equal(/^\s*export\s/m.test(text), false, `${name} must not use export`);
  }
});

test("classic files in one content_scripts entry never redeclare a shared global", () => {
  for (const [index, entry] of Object.entries(manifest.content_scripts ?? [])) {
    const files = entry.js ?? [];
    assert.ok(files.length > 0, `content_scripts[${index}] must list at least one file`);
    // Chrome runs every classic file of one entry against the same global lexical
    // scope, so a top-level name declared twice is a SyntaxError that silently kills
    // the second file. Compiling the concatenation reproduces exactly that failure.
    const combined = files.map((file) => read(file)).join("\n");
    assert.doesNotThrow(
      () => new vm.Script(combined, { filename: `content_scripts[${index}]` }),
      `content_scripts[${index}] (${files.join(", ")}) must share one global scope without redeclaring names`,
    );
  }
});

test("content scripts keep the page global scope clean", () => {
  for (const name of allContentScripts) {
    const text = read(name);
    const topLevelDeclaration = /^(?:const|let|var|function|class)\s/m;
    assert.equal(
      topLevelDeclaration.test(text),
      false,
      `${name} must wrap its body in an IIFE instead of declaring top-level names`,
    );
  }
});
