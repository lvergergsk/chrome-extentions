import assert from "node:assert/strict";
import test from "node:test";
import { filterUnvisited, OPEN_INTERVAL_MS, visitUrlVariants } from "./sukebei-open-unseen-bg.js";

test("open interval is about three seconds", () => {
  assert.equal(OPEN_INTERVAL_MS, 3000);
});

test("visitUrlVariants covers http and https", () => {
  assert.deepEqual(visitUrlVariants("https://sukebei.nyaa.si/view/1"), [
    "https://sukebei.nyaa.si/view/1",
    "http://sukebei.nyaa.si/view/1",
  ]);
});

test("filterUnvisited drops URLs that already have history visits", async () => {
  const visited = new Set(["https://sukebei.nyaa.si/view/old"]);
  const unseen = await filterUnvisited(
    [
      "https://sukebei.nyaa.si/view/old",
      "https://sukebei.nyaa.si/view/new",
    ],
    async (url) => (visited.has(url) ? [{ visitId: "1" }] : []),
  );
  assert.deepEqual(unseen, ["https://sukebei.nyaa.si/view/new"]);
});
