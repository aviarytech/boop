import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/analytics-test";

async function loadAnalytics(env = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/lib/analytics.ts"],
    outfile: `${outdir}/analytics.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  for (const k of ["POSTHOG_KEY", "POSTHOG_HOST", "VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST", "POSTHOG_DEBUG"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/analytics.mjs`).href}?t=${Date.now()}`
  );
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return handler(input, init, calls.length);
  };
  return calls;
}

test("captureEvent posts to /capture with the right payload", async () => {
  const m = await loadAnalytics({
    POSTHOG_KEY: "phc_test",
    POSTHOG_HOST: "https://example.posthog.com",
  });
  const calls = stubFetch(async () => new Response('{"status":1}', { status: 200 }));
  await m.captureEvent({
    event: "site_view",
    distinctId: "anon_abc",
    properties: { siteId: "s1", hostname: "x.boop.ad" },
    timestamp: new Date("2026-05-22T12:34:56.000Z"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.posthog.com/capture/");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.api_key, "phc_test");
  assert.equal(body.event, "site_view");
  assert.equal(body.distinct_id, "anon_abc");
  assert.equal(body.properties.siteId, "s1");
  assert.equal(body.properties.hostname, "x.boop.ad");
  assert.equal(body.properties.$lib, "boop-server");
  assert.equal(body.properties.$process_person_profile, false);
  assert.equal(body.timestamp, "2026-05-22T12:34:56.000Z");
});

test("captureEvent no-ops silently when no api key", async () => {
  const m = await loadAnalytics({});
  const calls = stubFetch(async () => new Response("nope", { status: 500 }));
  await m.captureEvent({ event: "site_view", distinctId: "anon_abc" });
  assert.equal(calls.length, 0);
});

test("captureEvent falls back to VITE_POSTHOG_* and default host", async () => {
  const m = await loadAnalytics({
    VITE_POSTHOG_KEY: "phc_vite",
  });
  const calls = stubFetch(async () => new Response('{"status":1}', { status: 200 }));
  await m.captureEvent({ event: "site_view", distinctId: "anon_abc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://us.i.posthog.com/capture/");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.api_key, "phc_vite");
});

test("captureEvent swallows fetch errors", async () => {
  const m = await loadAnalytics({ POSTHOG_KEY: "phc_test" });
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  await m.captureEvent({ event: "site_view", distinctId: "anon_abc" });
  // Should not throw — no assertion needed beyond reaching this line.
});

test("anonDistinctId is stable across same day, different across days", async () => {
  const m = await loadAnalytics({});
  const day1a = await m.anonDistinctId("1.2.3.4", "Mozilla/5.0", new Date("2026-05-22T01:00:00Z"));
  const day1b = await m.anonDistinctId("1.2.3.4", "Mozilla/5.0", new Date("2026-05-22T23:00:00Z"));
  const day2 = await m.anonDistinctId("1.2.3.4", "Mozilla/5.0", new Date("2026-05-23T01:00:00Z"));
  assert.equal(day1a, day1b);
  assert.notEqual(day1a, day2);
  assert.match(day1a, /^anon_[0-9a-f]{24}$/);
});

test("anonDistinctId differs by IP", async () => {
  const m = await loadAnalytics({});
  const a = await m.anonDistinctId("1.2.3.4", "ua", new Date("2026-05-22T00:00:00Z"));
  const b = await m.anonDistinctId("5.6.7.8", "ua", new Date("2026-05-22T00:00:00Z"));
  assert.notEqual(a, b);
});
