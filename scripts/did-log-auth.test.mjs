/**
 * DID log write authorization.
 *
 * Two independent doors used to be open: POST /api/did/log accepted any
 * `Authorization: Bearer <anything>` without verifying the token, and
 * `api.didLogs.upsertDidLog` was a public mutation callable directly. Either
 * let anyone overwrite anyone's served did.jsonl, keyed on a userDid they
 * supplied themselves.
 *
 * These tests cover the two pure seams that close it: the token verifier's
 * claim pinning, and the binding of a write to the caller's own sub-org.
 */

import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as jose from "jose";

const outdir = "tmp/did-log-auth-test";

async function bundle(entry, name) {
  await build({
    entryPoints: [entry],
    outfile: `${outdir}/${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["jose"],
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const JWT_SECRET = "test-secret-at-least-32-characters-long!!";
process.env.JWT_SECRET = JWT_SECRET;
const secret = new TextEncoder().encode(JWT_SECRET);

const jwt = await bundle("convex/lib/jwt.ts", "jwt");
const didLogAuth = await bundle("convex/lib/didLogAuth.ts", "didLogAuth");

const SUB_ORG = "abcdef0123456789fedcba9876543210";
const SLUG = "user-abcdef0123456789";

/** A token exactly as convex/authInternal.ts mints one. */
function mintToken(overrides = {}) {
  const {
    issuer = "originals-auth",
    audience = "originals-api",
    expiry = "30d",
    sub = SUB_ORG,
    email = "user@example.com",
    signingSecret = secret,
  } = overrides;

  let builder = new jose.SignJWT({ sub, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  if (expiry !== null) builder = builder.setExpirationTime(expiry);
  if (issuer !== null) builder = builder.setIssuer(issuer);
  if (audience !== null) builder = builder.setAudience(audience);
  return builder.sign(signingSecret);
}

async function rejects(promise, description) {
  await assert.rejects(promise, description);
}

// --- verifyAuthToken: a genuine token still works -------------------------

{
  const payload = await jwt.verifyAuthToken(await mintToken());
  assert.equal(payload.turnkeySubOrgId, SUB_ORG);
  assert.equal(payload.email, "user@example.com");
}

// --- verifyAuthToken: claim pinning ---------------------------------------

// The minter sets iss/aud; a token from any other service signed with the same
// JWT_SECRET must not be accepted as a boop session.
{
  await rejects(
    jwt.verifyAuthToken(await mintToken({ issuer: "some-other-service" })),
    /"iss"/
  );
  await rejects(jwt.verifyAuthToken(await mintToken({ issuer: null })), /"iss"/);
}

{
  await rejects(
    jwt.verifyAuthToken(await mintToken({ audience: "some-other-api" })),
    /"aud"/
  );
  await rejects(jwt.verifyAuthToken(await mintToken({ audience: null })), /"aud"/);
}

// An unexpiring session token is not a session.
{
  await rejects(jwt.verifyAuthToken(await mintToken({ expiry: null })), /"exp"/);
}

{
  await rejects(jwt.verifyAuthToken(await mintToken({ expiry: "-1h" })), /expired/i);
}

// Signature still has to hold.
{
  const wrongSecret = new TextEncoder().encode("a-completely-different-secret-key-32!!");
  await rejects(jwt.verifyAuthToken(await mintToken({ signingSecret: wrongSecret })), /.*/);
}

// alg:none must never be accepted.
{
  const unsecured = new jose.UnsecuredJWT({ sub: SUB_ORG, email: "user@example.com" })
    .setIssuedAt()
    .setIssuer("originals-auth")
    .setAudience("originals-api")
    .setExpirationTime("30d")
    .encode();
  await rejects(jwt.verifyAuthToken(unsecured), /.*/);
}

{
  await rejects(jwt.verifyAuthToken(""), /required/i);
  await rejects(jwt.verifyAuthToken("not-a-jwt"), /.*/);
}

// --- didLogPathForSubOrg mirrors the client's toUserSlug ------------------

// src/lib/webvh.ts toUserSlug: `user-${subOrgId.slice(0, 16)}`. If these ever
// disagree, every honest write starts failing.
{
  assert.equal(didLogAuth.didLogPathForSubOrg(SUB_ORG), SLUG);
  assert.equal(didLogAuth.didLogPathForSubOrg("short"), "user-short");
}

// --- assertDidLogOwnership: the honest client passes ----------------------

{
  didLogAuth.assertDidLogOwnership({
    subOrgId: SUB_ORG,
    userDid: `did:webvh:QmScid123:boop.ad:${SLUG}`,
    path: SLUG,
  });
}

// A dev domain carrying a port must not break the binding.
{
  didLogAuth.assertDidLogOwnership({
    subOrgId: SUB_ORG,
    userDid: `did:webvh:QmScid123:localhost%3A5173:${SLUG}`,
    path: SLUG,
  });
}

// --- assertDidLogOwnership: the attacks ----------------------------------

// Squatting another user's serving path.
{
  assert.throws(
    () =>
      didLogAuth.assertDidLogOwnership({
        subOrgId: SUB_ORG,
        userDid: `did:webvh:QmScid123:boop.ad:${SLUG}`,
        path: "user-victimsuborg1234",
      }),
    /path/i
  );
}

// Authenticating as yourself but writing a log under the victim's DID.
{
  assert.throws(
    () =>
      didLogAuth.assertDidLogOwnership({
        subOrgId: SUB_ORG,
        userDid: "did:webvh:QmScid123:boop.ad:user-victimsuborg1234",
        path: SLUG,
      }),
    /did/i
  );
}

// A DID whose path merely ends with the slug as a substring, not a segment.
{
  assert.throws(
    () =>
      didLogAuth.assertDidLogOwnership({
        subOrgId: SUB_ORG,
        userDid: `did:webvh:QmScid123:boop.ad:evil${SLUG}`,
        path: SLUG,
      }),
    /did/i
  );
}

// Only did:webvh logs belong here.
{
  assert.throws(
    () =>
      didLogAuth.assertDidLogOwnership({
        subOrgId: SUB_ORG,
        userDid: `did:key:z6MkTest:${SLUG}`,
        path: SLUG,
      }),
    /did:webvh/i
  );
}

// A caller with no sub-org can never derive a path.
{
  assert.throws(
    () =>
      didLogAuth.assertDidLogOwnership({
        subOrgId: "",
        userDid: `did:webvh:QmScid123:boop.ad:${SLUG}`,
        path: SLUG,
      }),
    /sub-organization/i
  );
}

// --- every didLogs write path is behind the ownership check ---------------

// The helper being correct proves nothing if a new endpoint writes the table
// without calling it — which is exactly how the re-mint path (#217) opened a
// second door. Any file that runs a didLogs-writing mutation must import the
// check; a bare unit test would not have caught this.
{
  const { readdir, readFile } = await import("node:fs/promises");
  const files = (await readdir("convex", { recursive: true })).filter(
    (f) => f.endsWith(".ts") && !f.startsWith("_generated")
  );

  const writers = /runMutation\(\s*internal\.[\w.]*(?:upsertDidLog|storeDidLog)/;

  for (const file of files) {
    const src = await readFile(`convex/${file}`, "utf8");
    if (!writers.test(src)) continue;
    assert.ok(
      src.includes("assertDidLogOwnership"),
      `convex/${file} writes a didLogs row without asserting ownership`
    );
  }
}

await rm(outdir, { recursive: true, force: true });

console.log("did-log-auth: all assertions passed");
