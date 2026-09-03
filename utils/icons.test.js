import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(utilsDir, "manifest.json"), "utf8"));

const pngSize = (buffer) => {
  assert.equal(buffer[0], 0x89);
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
};

test("manifest ships toolbar and management icons", () => {
  for (const size of ["16", "32", "48", "128"]) {
    assert.equal(manifest.icons[size], `icons/${size}.png`);
  }
  assert.equal(manifest.action.default_icon["16"], "icons/16.png");
  assert.equal(manifest.action.default_icon["32"], "icons/32.png");
});

test("icon PNGs match their declared pixel sizes", () => {
  for (const size of [16, 32, 48, 128]) {
    const png = readFileSync(path.join(utilsDir, "icons", `${size}.png`));
    const { width, height, colorType } = pngSize(png);
    assert.equal(width, size);
    assert.equal(height, size);
    assert.equal(colorType, 6, "must be RGBA");
  }
});
