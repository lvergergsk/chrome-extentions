import assert from "node:assert/strict";
import test from "node:test";
import { readClaudeUsage, sanitizeClaudeUsage } from "./claude-usage.js";
import { validateRequest } from "./browser-bridge.js";

const org = { uuid: "00000000-0000-4000-8000-000000000001", capabilities: ["chat", "claude_pro"] };
const bootstrap = { account: { email: "private@example.invalid", memberships: [{ organization: org }] } };
const grant = { id: "test_grant", label: "private label", resets_left: 2,
  starts_at: "2026-09-22T00:00:00Z", ends_at: "2026-10-05T00:00:00Z", paused: false };
const usage = { five_hour: { utilization: 1, resets_at: "2026-09-23T08:00:00Z" },
  seven_day: { utilization: 40, resets_at: "2026-09-29T00:00:00Z" },
  cedar_ember: { eligible: true, grants: [grant], event_props: { billing_path: "private" } },
  account_uuid: "private-account", other: "discard" };

test("live fixed GETs reuse Chrome session and emit only quota and reset fields", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return Response.json(url.includes("/bootstrap?") ? bootstrap : usage);
  };
  const result = await readClaudeUsage(fetchFn);
  assert.deepEqual(result, {
    five_hour: { utilization: 1, resets_at: "2026-09-23T08:00:00.000Z" },
    seven_day: { utilization: 40, resets_at: "2026-09-29T00:00:00.000Z" },
    cedar_ember: { eligible: true, grants: [{ resets_left: 2,
      starts_at: "2026-09-22T00:00:00.000Z", ends_at: "2026-10-05T00:00:00.000Z", paused: false }] },
  });
  await readClaudeUsage(fetchFn);
  assert.deepEqual(calls, [
    "https://claude.ai/api/bootstrap?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false",
    `https://claude.ai/api/organizations/${org.uuid}/usage?cedar_ember=1&skip_spend=1`,
    "https://claude.ai/api/bootstrap?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false",
    `https://claude.ai/api/organizations/${org.uuid}/usage?cedar_ember=1&skip_spend=1`,
  ]);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("ambiguous, missing, non-personal and malformed organizations never reach usage", async () => {
  for (const memberships of [[], [{ organization: org }, { organization: org }],
    [{ organization: { ...org, uuid: "../escape" } }],
    [{ organization: { ...org, capabilities: ["chat", "claude_pro", "api"] } }],
    [{ organization: { ...org, capabilities: ["chat", "claude_pro", "raven"] } }]]) {
    let count = 0;
    await assert.rejects(readClaudeUsage(async () => {
      count += 1;
      return Response.json({ account: { memberships } });
    }), /check the Chrome login/);
    assert.equal(count, 1);
  }
});

test("unknown and malformed reset inventories remain unknown without leaking metadata", () => {
  for (const block of [null, {}, { eligible: true },
    { eligible: true, grants: [{ ...grant, resets_left: -1 }] },
    { eligible: true, grants: [{ ...grant, paused: "false" }] },
    { eligible: true, grants: [{ ...grant, ends_at: "2026-10-05" }] },
    { eligible: true, grants: [grant, grant] }]) {
    assert.equal(sanitizeClaudeUsage({ ...usage, cedar_ember: block }).cedar_ember, null);
  }
  assert.deepEqual(sanitizeClaudeUsage({ ...usage, cedar_ember: {
    eligible: false, ineligible_reason: "private-account", grants: [grant],
  } }).cedar_ember, { eligible: false, ineligible_reason: "unavailable" });
  assert.deepEqual(sanitizeClaudeUsage({ ...usage, cedar_ember: {
    eligible: true, grants: [],
  } }).cedar_ember, { eligible: true, grants: [] });
  assert.throws(() => sanitizeClaudeUsage({ five_hour: { utilization: NaN } }), /no quota/);
});

test("network errors, non-JSON, HTTP failures and oversized bodies are sanitized", async () => {
  for (const fetchFn of [
    async () => { throw new Error("private-account secret URL"); },
    async () => new Response("private-account", { status: 403 }),
    async () => new Response("<html>private-account</html>"),
    async () => new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    await assert.rejects(readClaudeUsage(fetchFn), (error) => {
      assert.equal(error.message, "Claude web usage unavailable; check the Chrome login and subscription.");
      return true;
    });
  }
});

test("Claude bridge method rejects all caller-supplied parameters", () => {
  const request = { id: "a".repeat(32), method: "claude.usage", params: {} };
  assert.doesNotThrow(() => validateRequest(request));
  for (const params of [{ url: "https://example.com" }, { script: "code" }, { redeem: true }, { headers: {} }]) {
    assert.throws(() => validateRequest({ ...request, params }), /Invalid browser parameters/);
  }
});
