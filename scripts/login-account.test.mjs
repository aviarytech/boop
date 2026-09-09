import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { getFunctionName } from "convex/server";

const outdir = "tmp/login-account-test";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
async function load(name) {
  await build({ entryPoints: [`convex/${name}.ts`], outfile: `${outdir}/${name}.mjs`, bundle: true, platform: "node", format: "esm", external: ["convex/*", "jose"] });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href);
}
const auth = await load("auth");
const actions = await load("authInternal");
const handler = (fn) => fn._handler ?? fn.handler;
const EMAIL = "owner@example.com";
const original = { _id: "original", email: EMAIL, turnkeySubOrgId: "boop-identity", did: "did:webvh:original", displayName: "Owner" };
const duplicate = { _id: "duplicate", email: EMAIL, turnkeySubOrgId: "other-app-identity", did: "did:webvh:duplicate", displayName: "Owner" };

function context(initial = []) {
  const users = structuredClone(initial);
  return {
    users,
    scheduler: { runAfter: async () => {} },
    db: {
      get: async (id) => users.find((u) => u._id === id) ?? null,
      patch: async (id, patch) => Object.assign(users.find((u) => u._id === id), patch),
      insert: async (table, fields) => {
        assert.equal(table, "users");
        const row = { _id: `new-${users.length}`, ...fields };
        users.push(row);
        return row._id;
      },
      query: (table) => {
        assert.equal(table, "users");
        let rows = users;
        const query = {
          withIndex: (_index, f) => {
            f({ eq: (field, value) => { rows = rows.filter((row) => row[field] === value); } });
            return query;
          },
          first: async () => rows[0] ?? null,
          collect: async () => rows,
        };
        return query;
      },
    },
    async runQuery(ref, args) {
      assert.equal(getFunctionName(ref), "auth:getLoginAccount");
      return handler(auth.getLoginAccount)(this, args);
    },
  };
}

// Use the real action, request signing, and response parsing. Only the network
// boundary is replaced; no OTP, identities, or user data reach a live service.
async function withTurnkey(run) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const x = Buffer.from(jwk.x, "base64url"), y = Buffer.from(jwk.y, "base64url");
  const vars = { TURNKEY_API_PUBLIC_KEY: `${y.at(-1) % 2 ? "03" : "02"}${x.toString("hex")}`, TURNKEY_API_PRIVATE_KEY: Buffer.from(jwk.d, "base64url").toString("hex"), TURNKEY_ORGANIZATION_ID: "shared-parent" };
  const oldEnv = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("list_suborgs")) return Response.json({ organizationIds: ["other-app-identity", "boop-identity"] });
    if (url.endsWith("create_sub_organization")) return Response.json({ activity: { result: { createSubOrganizationResultV7: { subOrganizationId: "fresh-boop-identity" } } } });
    if (url.endsWith("init_otp")) return Response.json({ activity: { result: { initOtpResult: { otpId: "otp" } } } });
    if (url.endsWith("verify_otp")) return Response.json({ activity: { result: { verifyOtpResult: { verificationToken: "verified" } } } });
    throw new Error(`Unexpected request: ${url}`);
  };
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const initiate = (ctx) => handler(actions.initiateAuth)(ctx, { email: EMAIL });
const verify = (ctx, subOrgId) => handler(actions.verifyAuth)(ctx, { sessionId: "session", code: "123456", session: { email: EMAIL, subOrgId, otpId: "otp", timestamp: Date.now(), verified: false } });

test("returning login keeps the Boop identity despite a foreign first Turnkey match", async () => {
  await withTurnkey(async (calls) => {
    const result = await initiate(context([original]));
    assert.equal(result.session.subOrgId, original.turnkeySubOrgId);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("init_otp"));
  });
});

test("new Boop signup provisions its own identity instead of adopting another app's", async () => {
  await withTurnkey(async (calls) => {
    const result = await initiate(context());
    assert.equal(result.session.subOrgId, "fresh-boop-identity");
    assert.deepEqual(calls.map((c) => c.url.split("/").at(-1)), ["create_sub_organization", "init_otp"]);
  });
});

test("ambiguous duplicate accounts stop login before any Turnkey call", async () => {
  await withTurnkey(async (calls) => {
    await assert.rejects(initiate(context([original, duplicate])), /account recovery/i);
    assert.equal(calls.length, 0);
  });
});

test("operator selection restores the original identity without moving data", async () => {
  const ctx = context([duplicate, original]);
  assert.equal(auth.selectLoginAccount.isInternal, true);
  await handler(auth.selectLoginAccount)(ctx, { email: EMAIL, userId: original._id });
  assert.deepEqual(ctx.users.map((u) => u.did), [duplicate.did, original.did]);
  await withTurnkey(async () => {
    assert.equal((await initiate(ctx)).session.subOrgId, original.turnkeySubOrgId);
    assert.equal((await verify(ctx, original.turnkeySubOrgId)).subOrgId, original.turnkeySubOrgId);
  });
  await assert.rejects(handler(auth.selectLoginAccount)(ctx, { email: "someone@example.com", userId: original._id }), /email/i);
  assert.equal(ctx.users.find((u) => u._id === original._id).isCanonicalLogin, true);
});

test("multiple canonical flags and a legacy account with no Turnkey link fail closed", async () => {
  for (const users of [[{ ...original, isCanonicalLogin: true }, { ...duplicate, isCanonicalLogin: true }], [{ ...original, turnkeySubOrgId: undefined }]]) {
    await withTurnkey(async (calls) => {
      await assert.rejects(initiate(context(users)), /account recovery/i);
      assert.equal(calls.length, 0);
    });
  }
});

test("database lookup failure never falls through to provisioning", async () => {
  await withTurnkey(async (calls) => {
    const ctx = context();
    ctx.runQuery = async () => { throw new Error("database unavailable"); };
    await assert.rejects(initiate(ctx), /database unavailable/);
    assert.equal(calls.length, 0);
  });
});

test("verification rejects an old session pointing at a different account", async () => {
  await withTurnkey(async (calls) => {
    await assert.rejects(verify(context([original]), duplicate.turnkeySubOrgId), /request a new code/i);
    assert.equal(calls.length, 0);
  });
});

test("competing signup sessions cannot insert a second user for an existing email", async () => {
  const ctx = context();
  const upsert = handler(auth.upsertUser);
  await upsert(ctx, { email: EMAIL, turnkeySubOrgId: "first-signup" });
  await assert.rejects(upsert(ctx, { email: EMAIL, turnkeySubOrgId: "second-signup" }), /request a new code/i);
  assert.equal(ctx.users.length, 1);
  assert.equal(ctx.users[0].turnkeySubOrgId, "first-signup");
});

test("unfinished signup for another email cannot be linked through an undefined DID", async () => {
  const ctx = context([{ ...original, did: undefined }]);
  await handler(auth.upsertUser)(ctx, { email: "new@example.com", turnkeySubOrgId: "new-identity" });
  assert.equal(ctx.users.length, 2);
  assert.equal(ctx.users[0].turnkeySubOrgId, original.turnkeySubOrgId);
});

test("upsert rechecks operator selection after OTP verification", async () => {
  const ctx = context([{ ...original, isCanonicalLogin: true }, { ...duplicate, isCanonicalLogin: false }]);
  await assert.rejects(handler(auth.upsertUser)(ctx, { email: EMAIL, turnkeySubOrgId: duplicate.turnkeySubOrgId }), /request a new code/i);
  assert.equal(ctx.users.length, 2);
  assert.equal(ctx.users[1].lastLoginAt, undefined);
  await handler(auth.upsertUser)(ctx, { email: EMAIL, turnkeySubOrgId: original.turnkeySubOrgId });
  assert.equal(ctx.users.length, 2);
  assert.ok(ctx.users[0].lastLoginAt);
});

test("an existing identity cannot be reused under a different email", async () => {
  const ctx = context([original]);
  await assert.rejects(handler(auth.upsertUser)(ctx, { email: "stranger@example.com", turnkeySubOrgId: original.turnkeySubOrgId }), /different email/i);
  assert.equal(ctx.users[0].lastLoginAt, undefined);
});
