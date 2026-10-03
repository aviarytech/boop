import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { generateP256KeyPair } from "@turnkey/crypto";
import { OriginalsCel } from "@originals/sdk";

const outdir = "tmp/turnkey-session-test";

/**
 * Turnkey itself is remote, so its HTTP endpoint is stubbed — but the stamping,
 * payload construction, signature normalization and CEL proof path are all the
 * real code.
 */
async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["turnkeySession", "originalsSigner"]) {
    await build({
      entryPoints: [`src/lib/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
    });
  }
  return {
    session: await import(pathToFileURL(`${process.cwd()}/${outdir}/turnkeySession.mjs`).href),
    signer: await import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href),
  };
}

const { session, signer } = await loadModules();

/** A Turnkey stand-in: signs with a local Ed25519 key, answers like the API. */
function stubTurnkey({ ok = true } = {}) {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const apiKeys = generateP256KeyPair();
  const requests = [];

  const signingSession = {
    apiPublicKey: apiKeys.publicKey,
    apiPrivateKey: apiKeys.privateKey,
    subOrgId: "suborg-123",
    signingAddress: base58.encode(publicKey),
    expiresAt: Date.now() + 3_600_000,
  };

  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    if (!ok) {
      return { ok: false, status: 403, async text() { return "forbidden"; } };
    }
    const { payload } = JSON.parse(init.body).parameters;
    const hex = payload.startsWith("0x") ? payload.slice(2) : payload;
    const bytes = Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
    const sig = Buffer.from(ed25519.sign(bytes, privateKey)).toString("hex");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          activity: { result: { signRawPayloadResult: { r: sig.slice(0, 64), s: sig.slice(64) } } },
        };
      },
    };
  };

  return { publicKey, signingSession, fetchImpl, requests };
}

test("createSessionTargetKey produces an uncompressed P-256 target key", () => {
  const target = session.createSessionTargetKey();

  assert.match(target.targetPublicKey, /^04[0-9a-f]{128}$/, "HPKE wants the uncompressed form");
  assert.match(target.targetPrivateKey, /^[0-9a-f]{64}$/);
  assert.notEqual(
    session.createSessionTargetKey().targetPrivateKey,
    target.targetPrivateKey,
    "each login gets a fresh target key"
  );
});

test("isSessionExpired treats the skew window as already expired", () => {
  const now = 1_800_000_000_000;

  assert.equal(session.isSessionExpired({ expiresAt: now + 600_000 }, now), false);
  assert.equal(session.isSessionExpired({ expiresAt: now - 1 }, now), true);
  assert.equal(session.isSessionExpired(null, now), true, "no session is an expired session");
  assert.equal(
    session.isSessionExpired({ expiresAt: now + 10_000 }, now),
    true,
    "a signature started this close to expiry would fail mid-flight"
  );
});

test("createSessionSigner derives its Multikey from the account address", () => {
  const turnkey = stubTurnkey();
  const raw = session.createSessionSigner(turnkey.signingSession, turnkey.fetchImpl);

  assert.equal(
    raw.publicKeyMultibase,
    signer.multikeyFromEd25519PublicKey(turnkey.publicKey),
    "the Solana-format address must be converted, not passed through"
  );
});

test("signBytes asks Turnkey for a raw, unhashed signature", async () => {
  const turnkey = stubTurnkey();
  const raw = session.createSessionSigner(turnkey.signingSession, turnkey.fetchImpl);

  const signature = await raw.signBytes(new TextEncoder().encode("boop"));

  assert.equal(signature.length, 64, "Ed25519 signatures are 64 bytes");
  assert.equal(turnkey.requests.length, 1);

  const [request] = turnkey.requests;
  assert.match(request.url, /sign_raw_payload$/);
  assert.equal(request.body.type, "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2");
  assert.equal(request.body.organizationId, "suborg-123");
  assert.equal(request.body.parameters.encoding, "PAYLOAD_ENCODING_HEXADECIMAL");
  assert.equal(
    request.body.parameters.hashFunction,
    "HASH_FUNCTION_NO_OP",
    "Ed25519 hashes internally; pre-hashing would produce an unverifiable signature"
  );
  assert.equal(request.body.parameters.signWith, turnkey.signingSession.signingAddress);
  assert.equal(request.body.parameters.payload, `0x${Buffer.from("boop").toString("hex")}`);
});

test("every request carries a Turnkey stamp", async () => {
  const turnkey = stubTurnkey();
  const raw = session.createSessionSigner(turnkey.signingSession, turnkey.fetchImpl);

  await raw.signBytes(new Uint8Array([1, 2, 3]));

  const { headers } = turnkey.requests[0].init;
  assert.ok(headers["X-Stamp"], `expected an X-Stamp header, got ${JSON.stringify(headers)}`);
});

test("a Turnkey-signed genesis event verifies end to end", async () => {
  const turnkey = stubTurnkey();
  const raw = session.createSessionSigner(turnkey.signingSession, turnkey.fetchImpl);

  const cel = new OriginalsCel({
    layer: "peer",
    signer: signer.createCelSigner(raw),
    config: { peer: { verificationMethod: signer.verificationMethodId(raw) } },
  });

  const { log, did } = await cel.create("Groceries", []);
  assert.match(did, /^did:cel:/);

  const result = await cel.verify(log);
  assert.equal(
    result.verified,
    true,
    `Turnkey-signed genesis must verify: ${JSON.stringify(result.errors)}`
  );
});

test("an expired session refuses to sign rather than failing at Turnkey", async () => {
  const turnkey = stubTurnkey();
  const raw = session.createSessionSigner(
    { ...turnkey.signingSession, expiresAt: Date.now() - 1000 },
    turnkey.fetchImpl
  );

  await assert.rejects(() => raw.signBytes(new Uint8Array([1])), /expired/i);
  assert.equal(turnkey.requests.length, 0, "no point spending a round-trip on a dead session");
});

test("a Turnkey error surfaces instead of yielding a bad signature", async () => {
  const turnkey = stubTurnkey({ ok: false });
  const raw = session.createSessionSigner(turnkey.signingSession, turnkey.fetchImpl);

  await assert.rejects(() => raw.signBytes(new Uint8Array([1, 2, 3])), /403|forbidden/i);
});
