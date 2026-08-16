import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));

const read = (name) => readFileSync(path.join(utilsDir, name), "utf8");

test("content scripts stay classic so Chrome 151 can parse them", () => {
  for (const name of ["x-media.js", "x-media-page.js", "x-media-core.js"]) {
    const text = read(name);
    assert.equal(/^\s*import\s/m.test(text), false, `${name} must not use import`);
    assert.equal(/^\s*export\s/m.test(text), false, `${name} must not use export`);
  }
});
