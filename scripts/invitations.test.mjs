import { test } from "node:test";
import assert from "node:assert/strict";
import { ConvexError } from "convex/values";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { SignJWT } from "jose";
import { fixture, sessions, credentials, digest, PRIVATE_SHARING_JWT_SECRET } from "./helpers/private-sharing-fixture.mjs";

const names = ["invitations", "invitationMail", "listGrants", "lists", "users"];
await build({ entryPoints: names.map(name => `convex/${name}.ts`), outdir: "tmp/invitation-test",
  define: { "process.env.JWT_SECRET": JSON.stringify(PRIVATE_SHARING_JWT_SECRET) },
  bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, external: ["convex/*", "@originals/*"],
});
const modules = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(`${process.cwd()}/tmp/invitation-test/${name}.mjs`))])));
const make = () => {
  const ctx = fixture(modules);
  for (const user of ctx.rows.users) Object.assign(user, { displayName: `${user.displayName} Friend`, displayNameChosenAt: 1 });
  ctx.db.normalizeId = (_table, id) => id.startsWith("listInvitations-") ? id : null;
  return ctx;
};
const call = (name, ctx, args = {}) => modules.invitations[name]._handler(ctx, args);
const owner = credentials("owner");
let request = 0;
const create = (ctx, extra = {}) => call("createInvitation", ctx, { ...owner, listId: "L", email: "recipient@example.test", requestId: `request_${++request}`, ...extra });
const manage = value => ({ ...owner, listId: "L", ...value });
async function login(ctx, email = "recipient@example.test", name = "pending") {
  const user = ctx.rows.users.find(u => u._id === `U-${name}`);
  const token = await new SignJWT({ email }).setProtectedHeader({ alg: "HS256" }).setSubject(user.turnkeySubOrgId)
    .setIssuer("originals-auth").setAudience("originals-api").setExpirationTime("1h").sign(new TextEncoder().encode(PRIVATE_SHARING_JWT_SECRET));
  ctx.rows.accessSessions.push({ _id: `session-${++request}`, tokenHash: digest(token), subject: user.turnkeySubOrgId });
  return { authToken: token };
}
const unavailable = /Resource unavailable/;
const accept = (ctx, handle, auth) => call("acceptInvitation", ctx, { ...handle, ...auth, accept: true });

test("future and existing accounts receive identical viewer-default invitations; no account lookup or grant before explicit acceptance", async () => {
  for (const email of ["recipient@example.test", "pending@example.test"]) {
    const ctx = make();
    const invite = await create(ctx, { email: ` ${email.toUpperCase()} ` });
    assert.deepEqual(Object.keys(invite).sort(), ["invitationId", "version"]);
    assert.equal(ctx.rows.listInvitations[0].email, email);
    assert.equal(ctx.rows.listInvitations[0].role, "viewer");
    assert.equal(ctx.reads.some(r => r.index === "by_email"), false);
    assert.equal(ctx.rows.listGrants.length, 4);
    const auth = await login(ctx, email);
    assert.equal((await call("getPendingInvitations", ctx, auth)).length, 1);
    const preview = await call("getInvitation", ctx, { ...invite, ...auth });
    assert.deepEqual(Object.keys(preview).sort(), ["expiresAt", "invitationId", "inviter", "role", "version"]);
    assert.equal(JSON.stringify(preview).includes("Private list"), false);
    await assert.rejects(() => call("acceptInvitation", ctx, { ...invite, ...auth, accept: false }), unavailable);
    const accepted = await accept(ctx, invite, auth);
    assert.equal(accepted.role, "viewer");
    assert.equal(ctx.rows.listGrants.find(g => g._id === accepted.grantId).recipientId, "U-pending");
  }
});

test("forwarded locator, profile email spoof, API keys, missing and expired sessions fail closed", async () => {
  const ctx = make(), invite = await create(ctx);
  ctx.rows.users.find(u => u._id === "U-outsider").email = "recipient@example.test";
  assert.equal(await call("getInvitation", ctx, { ...invite, ...credentials("outsider") }), null);
  assert.deepEqual(await call("getPendingInvitations", ctx, credentials("outsider")), []);
  await assert.rejects(() => accept(ctx, invite, credentials("outsider")), unavailable);
  ctx.rows.agentApiKeys.find(k => k._id === "KEY-outsider").scopes = ["*"];
  for (const auth of [{}, { apiKey: "key-outsider" }]) {
    await assert.rejects(() => accept(ctx, invite, auth));
    await assert.rejects(() => call("getPendingInvitations", ctx, auth));
  }
  const auth = await login(ctx);
  ctx.rows.accessSessions.find(s => s.tokenHash === digest(auth.authToken)).revokedAt = Date.now();
  await assert.rejects(() => accept(ctx, invite, auth));
});

test("owner management enforces resource ownership and wildcard scope for public/internal adapters", async () => {
  const ctx = make(), invite = await create(ctx);
  for (const suffix of ["", "Internal"]) for (const name of ["editor", "viewer", "outsider"]) {
    for (const [operation, args] of [["createInvitation", { listId: "L", email: "x@example.test", requestId: "another_request" }],
      ["resendInvitation", { ...invite, listId: "L", requestId: "resend_request" }], ["revokeInvitation", { ...invite, listId: "L" }],
      ["updateInvitationRole", { ...invite, listId: "L", role: "editor" }], ["getListInvitations", { listId: "L" }]]) {
      await assert.rejects(() => call(operation + suffix, ctx, { ...args, ...credentials(name) }), unavailable);
    }
  }
  await assert.rejects(() => create(ctx, { apiKey: "key-owner" }), /Missing scope/);
  await assert.rejects(() => call("revokeInvitation", ctx, { ...manage(invite), listId: "X" }), unavailable);
});

test("seven day expiry, revoke, resend, stale delivery callbacks and replay cannot revive earlier versions", async () => {
  const ctx = make(), invite = await create(ctx), auth = await login(ctx);
  const row = ctx.rows.listInvitations[0];
  assert.equal(row.expiresAt - row.createdAt, 7 * 86400000);
  row.expiresAt = Date.now();
  assert.equal(await call("getInvitation", ctx, { ...invite, ...auth }), null);
  await assert.rejects(() => accept(ctx, invite, auth), unavailable);
  assert.equal((await call("getListInvitations", ctx, { ...owner, listId: "L" }))[0].status, "expired");
  const fresh = await call("resendInvitation", ctx, { ...manage(invite), requestId: "resend_request" });
  assert.equal(fresh.version, 2);
  await assert.rejects(() => accept(ctx, invite, auth), unavailable);
  await call("deliveryResult", ctx, { ...invite, delivery: "sent" });
  assert.equal(row.delivery, "queued");
  await call("revokeInvitation", ctx, manage(fresh));
  await assert.rejects(() => accept(ctx, fresh, auth), unavailable);
  assert.equal(await call("deliveryPayload", ctx, fresh), null);
  assert.deepEqual(await call("getPendingInvitations", ctx, auth), []);
});

test("acceptance uses current role; sequential transaction retries never duplicate, restore or overwrite accepted grants", async () => {
  const ctx = make(), invite = await create(ctx, { role: "editor" }), auth = await login(ctx);
  await call("updateInvitationRole", ctx, { ...manage(invite), role: "viewer" });
  const granted = await accept(ctx, invite, auth);
  assert.equal(granted.role, "viewer");
  assert.deepEqual(await accept(ctx, invite, auth), granted);
  assert.equal(ctx.rows.listGrants.filter(g => g.recipientId === "U-pending").length, 1);
  await modules.listGrants.updateListGrant._handler(ctx, { ...owner, listId: "L", grantId: granted.grantId, role: "editor" });
  assert.equal((await accept(ctx, invite, auth)).role, "editor");
  await modules.listGrants.revokeListGrant._handler(ctx, { ...owner, listId: "L", grantId: granted.grantId });
  await assert.rejects(() => accept(ctx, invite, auth), unavailable);
  ctx.rows.listGrantRevocations[0].revokedAt -= 1; // Advance beyond same-millisecond ambiguity.
  // A fresh owner resend is deliberate new authorization, with a new link/version.
  const fresh = await call("resendInvitation", ctx, { ...manage(invite), requestId: "reinvite_request" });
  await assert.rejects(() => accept(ctx, invite, auth), unavailable);
  assert.equal((await accept(ctx, fresh, auth)).role, "viewer");
});

test("existing grant role is preserved; accepted invitation binds to account even when another account verifies the email", async () => {
  const ctx = make(), invite = await create(ctx, { role: "editor" });
  const auth = await login(ctx, "recipient@example.test", "viewer");
  assert.equal((await accept(ctx, invite, auth)).role, "viewer");
  const differentAccount = await login(ctx, "recipient@example.test", "outsider");
  await assert.rejects(() => accept(ctx, invite, differentAccount), unavailable);
});

test("request idempotency survives later state changes; duplicate create does not resend or change role", async () => {
  const ctx = make();
  const first = await create(ctx, { requestId: "stable_request" });
  assert.deepEqual(await create(ctx, { requestId: "stable_request" }), first);
  assert.deepEqual(await create(ctx, { role: "editor" }), first);
  assert.equal(ctx.scheduled.length, 2);
  assert.equal(ctx.rows.listInvitations[0].role, "viewer");
  await assert.rejects(() => create(ctx, { requestId: "stable_request", role: "editor" }), /already used/);
  const fresh = await call("resendInvitation", ctx, { ...manage(first), requestId: "stable_resend" });
  await call("revokeInvitation", ctx, manage(fresh));
  assert.deepEqual(await call("resendInvitation", ctx, { ...manage(first), requestId: "stable_resend" }), fresh);
  assert.deepEqual(await create(ctx, { requestId: "stable_request" }), first);
  assert.equal(ctx.rows.listInvitations[0].status, "revoked");
  assert.equal(ctx.scheduled.length, 4);
});

test("owner and recipient budgets limit email abuse independently of account existence and product plan", async () => {
  const ctx = make();
  let invite = await create(ctx);
  for (let i = 0; i < 2; i++) invite = await call("resendInvitation", ctx, { ...manage(invite), requestId: `resend_limit_${i}` });
  await assert.rejects(() => call("resendInvitation", ctx, { ...manage(invite), requestId: "resend_limit_more" }), /rate limit/);
  const other = make();
  for (let i = 0; i < 30; i++) await create(other, { email: `recipient${i}@example.test` });
  await assert.rejects(() => create(other, { email: "one-more@example.test" }), /rate limit/);
  assert.equal(other.reads.some(r => r.table === "subscriptions"), false);
});

test("generic mail, stable provider idempotency, failure visibility, and obsolete jobs", async () => {
  const ctx = make(), invite = await create(ctx);
  const originalFetch = globalThis.fetch, originalKey = process.env.RESEND_API_KEY;
  const calls = [];
  process.env.RESEND_API_KEY = "fixture-only";
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false }; };
  try {
    await modules.invitationMail.deliver._handler(ctx.action, invite);
    assert.equal(ctx.rows.listInvitations[0].delivery, "failed");
    assert.equal((await call("getListInvitations", ctx, { ...owner, listId: "L" }))[0].delivery, "failed");
    const sent = JSON.parse(calls[0].options.body);
    assert.equal(sent.to, "recipient@example.test");
    assert.equal(sent.text.split("\n")[0], 'An account named "owner Friend" invited you to collaborate on boop.');
    for (const secret of ["Private list", "Secret item", "Private note", "attachments", "owner@example.test", '"listId"']) assert.equal(JSON.stringify(sent).includes(secret), false);
    assert.equal(calls[0].options.headers["Idempotency-Key"], `private-invitation/${invite.invitationId}/1`);
    const fresh = await call("resendInvitation", ctx, { ...manage(invite), requestId: "delivery_retry" });
    await modules.invitationMail.deliver._handler(ctx.action, invite);
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => ({ ok: true });
    await modules.invitationMail.deliver._handler(ctx.action, fresh);
    assert.equal(ctx.rows.listInvitations[0].delivery, "sent");
    delete process.env.RESEND_API_KEY;
    const next = await call("resendInvitation", ctx, { ...manage(fresh), requestId: "missing_mail_key" });
    await modules.invitationMail.deliver._handler(ctx.action, next);
    assert.equal(ctx.rows.listInvitations[0].delivery, "failed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
  }
});

test("owner deletion hides and removes invitations; recipient deletion blocks acceptance without trusting profile email", async () => {
  for (const target of ["owner", "pending"]) {
    const ctx = make(), invite = await create(ctx, { email: "pending@example.test" }), auth = await login(ctx, "pending@example.test");
    await modules.users.deleteUserData._handler(ctx, { userId: `U-${target}`, ...credentials(target) });
    await assert.rejects(() => accept(ctx, invite, auth));
    if (target === "owner") {
      assert.equal(await call("deliveryPayload", ctx, invite), null);
      assert.deepEqual(await call("getPendingInvitations", ctx, auth), []);
    }
    for (let i = 0; i < 100 && ctx.rows.users.some(u => u._id === `U-${target}`); i++) await modules.users.continueUserDeletion._handler(ctx, { userId: `U-${target}` });
    assert.equal(ctx.rows.listInvitations.length, target === "owner" ? 0 : 1);
    if (target === "owner") assert.equal(ctx.rows.invitationRequests.length, 0);
  }
});


test("spoofed profile email cannot erase another recipient's pending invitations", async () => {
  const ctx = make(), invite = await create(ctx);
  ctx.rows.users.find(u => u._id === "U-outsider").email = "recipient@example.test";
  await modules.users.deleteUserData._handler(ctx, { userId: "U-outsider", ...credentials("outsider") });
  for (let i = 0; i < 100 && ctx.rows.users.some(u => u._id === "U-outsider"); i++) await modules.users.continueUserDeletion._handler(ctx, { userId: "U-outsider" });
  assert.equal(ctx.rows.listInvitations[0]._id, invite.invitationId);
  const auth = await login(ctx);
  assert.equal((await accept(ctx, invite, auth)).role, "viewer");
});

test("persisted expiry updates subscriptions, while obsolete expiry tasks cannot expire a resend", async () => {
  const ctx = make(), invite = await create(ctx);
  const fresh = await call("resendInvitation", ctx, { ...manage(invite), requestId: "expire_resend" });
  ctx.rows.listInvitations[0].expiresAt = Date.now() - 1;
  await call("expireInvitation", ctx, invite);
  assert.equal(ctx.rows.listInvitations[0].status, "pending");
  await call("expireInvitation", ctx, fresh);
  assert.equal(ctx.rows.listInvitations[0].status, "expired");
});


test("unaccepted invitations issued before grant revocation cannot restore access or appear as pending", async () => {
  const ctx = make(), invite = await create(ctx, { role: "editor" }), auth = await login(ctx, "recipient@example.test", "viewer");
  await modules.listGrants.revokeListGrant._handler(ctx, { ...owner, listId: "L", grantId: "G-L-viewer" });
  await assert.rejects(() => accept(ctx, invite, auth), unavailable);
  assert.equal(await call("getInvitation", ctx, { ...invite, ...auth }), null);
  assert.deepEqual(await call("getPendingInvitations", ctx, auth), []);
  assert.equal(ctx.rows.listGrants.some(g => g.listId === "L" && g.recipientId === "U-viewer"), false);
  ctx.rows.listGrantRevocations[0].revokedAt -= 1;
  const fresh = await call("resendInvitation", ctx, { ...manage(invite), requestId: "explicit_reinvite" });
  assert.equal((await accept(ctx, fresh, auth)).role, "editor");
});

test("recipient daily budget spans owners, while owner budgets are not a lifetime recipient cap", async () => {
  const ctx = make();
  let delivered = 0;
  for (const name of ["owner", "editor", "viewer", "outsider"]) {
    for (let n = 0; n < 3; n++) {
      const listId = `owned-${name}-${n}`;
      ctx.rows.lists.push({ _id: listId, ownerDid: `did:${name}`, name: "Own resource" });
      const send = () => create(ctx, { ...credentials(name), listId });
      if (delivered === 10) { await assert.rejects(send, /rate limit/); break; }
      await send(); delivered++;
    }
  }
  assert.equal(delivered, 10);
  const fresh = make();
  for (let n = 0; n < 30; n++) await create(fresh, { email: `first${n}@example.test` });
  for (const row of fresh.rows.rateLimits) row.windowStart -= 3600001;
  await create(fresh, { email: "later@example.test" });
  assert.equal(fresh.rows.listInvitations.length, 31);
});


test("cached sharing sessions and recipient tokens are isolated from other suites' JWT secrets", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "another-suite-secret-must-not-affect-this-fixture";
  try {
    const ctx = make(), invite = await create(ctx), auth = await login(ctx);
    assert.equal((await accept(ctx, invite, auth)).role, "viewer");
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});


const setName = (ctx, displayName, auth = owner, suffix = "") => modules.users[`setPublicDisplayName${suffix}`]._handler(ctx, { ...auth, displayName });

test("inviter must explicitly save a valid public name; create and resend fail without side effects", async () => {
  for (const suffix of ["", "Internal"]) {
    for (const profile of [
      { displayName: "Alex Rivera", displayNameChosenAt: undefined },
      { displayName: "owner", displayNameChosenAt: undefined },
      { displayName: "owner", displayNameChosenAt: 1 },
      { displayName: " OWNER ", displayNameChosenAt: 1 },
      { displayName: "boop user", displayNameChosenAt: 1 },
      { displayName: "owner@example.test", displayNameChosenAt: 1 },
      { displayName: "", displayNameChosenAt: 1 },
    ]) {
      const ctx = make(), invite = await create(ctx);
      Object.assign(ctx.rows.users.find(u => u._id === "U-owner"), profile);
      const before = JSON.stringify([ctx.rows, ctx.scheduled]);
      await assert.rejects(() => call(`createInvitation${suffix}`, ctx, { ...owner, listId: "L", email: "next@example.test", requestId: "invalid_name_create" }), /Choose and save a recognizable public display name/);
      await assert.rejects(() => call(`resendInvitation${suffix}`, ctx, { ...manage(invite), requestId: "invalid_name_resend" }), /Choose and save a recognizable public display name/);
      assert.equal(JSON.stringify([ctx.rows, ctx.scheduled]), before);
    }
  }
});

test("public name setup validates privacy, updates only the signed-in account, and cannot be delegated to an API key", async () => {
  const ctx = make();
  const user = ctx.rows.users.find(u => u._id === "U-owner");
  delete user.displayNameChosenAt; user.displayName = "owner";
  assert.deepEqual(await modules.users.getMyPublicDisplayName._handler(ctx, owner), { displayName: null });
  for (const name of ["", " ", "A", "boop user", "BOOPUSER", "Anonymous", "12345", "fixture", "owner", " OWNER ", "owner@example.test", "Alex\nRivera", "Alex\u200bRivera", "x".repeat(81), "Alex＠example.test"]) {
    await assert.rejects(() => setName(ctx, name), /Choose a/);
    assert.equal(user.displayNameChosenAt, undefined);
  }
  ctx.rows.agentApiKeys.find(k => k._id === "KEY-owner").scopes = ["*"];
  for (const suffix of ["", "Internal"]) {
    await assert.rejects(() => setName(ctx, "Alex Rivera", {}, suffix));
    await assert.rejects(() => setName(ctx, "Alex Rivera", { apiKey: "key-owner" }, suffix), unavailable);
    await assert.rejects(() => setName(ctx, "Alex Rivera", { ...owner, userDid: "did:outsider" }, suffix), /Identity assertion/);
  }
  await setName(ctx, "  Álex Rivera  ");
  assert.equal(user.displayName, "Álex Rivera");
  assert.equal(typeof user.displayNameChosenAt, "number");
  assert.equal(ctx.rows.users.find(u => u._id === "U-outsider").displayName, "outsider Friend");
  assert.deepEqual(await modules.users.getMyPublicDisplayName._handler(ctx, owner), { displayName: "Álex Rivera" });
  assert.deepEqual(await modules.users.getUsersByDids._handler(ctx, { dids: ["did:owner"] }), { "did:owner": { displayName: "Álex Rivera" } });
  const invite = await create(ctx), auth = await login(ctx);
  assert.equal((await call("getInvitation", ctx, { ...invite, ...auth })).inviter, "Álex Rivera");
  assert.deepEqual(await call("deliveryPayload", ctx, invite), { email: "recipient@example.test", inviter: "Álex Rivera" });
});

test("pending historical identities never leak through preview or queued mail and cannot be accepted until explicitly chosen", async () => {
  for (const profile of [
    { displayName: "owner", displayNameChosenAt: undefined },
    { displayName: "Alex Rivera", displayNameChosenAt: undefined },
    { displayName: "boop user", displayNameChosenAt: undefined },
    { displayName: "owner@example.test", displayNameChosenAt: 1 },
    { displayName: "owner", displayNameChosenAt: 1 },
  ]) {
    const ctx = make(), invite = await create(ctx), auth = await login(ctx);
    Object.assign(ctx.rows.users.find(u => u._id === "U-owner"), profile);
    assert.equal(await call("getInvitation", ctx, { ...invite, ...auth }), null);
    assert.deepEqual(await call("getPendingInvitations", ctx, auth), []);
    assert.equal(await call("deliveryPayload", ctx, invite), null);
    const fetchBefore = globalThis.fetch;
    let mailCalls = 0;
    globalThis.fetch = async () => { mailCalls++; return { ok: true }; };
    try { await modules.invitationMail.deliver._handler(ctx.action, invite); }
    finally { globalThis.fetch = fetchBefore; }
    assert.equal(mailCalls, 0);
    await assert.rejects(() => accept(ctx, invite, auth), unavailable);
    assert.equal(ctx.rows.listGrants.length, 4);
    await setName(ctx, "Alex Rivera");
    const preview = await call("getInvitation", ctx, { ...invite, ...auth });
    assert.equal(preview.inviter, "Alex Rivera");
    assert.equal(JSON.stringify(preview).includes("owner@example.test"), false);
    const resent = await call("resendInvitation", ctx, { ...manage(invite), requestId: "name_fixed_resend" });
    assert.equal((await accept(ctx, resent, auth)).role, "viewer");
  }
});


test("link-shaped public names are rejected on save and revalidated across every invitation path", async () => {
  const badNames = [
    "Account locked - verify at evil.example/reset", "evil.example", "www.evil", "https://evil", "mailto:evil",
    "evil.example:443", "evil.c", "evil.1", "evil.123", "Click 127.0.0.1", "evil.рф", "evil.xn--p1ai", "evil.e\u0301xample",
    "ｅｖｉｌ．ｅｘａｍｐｌｅ", "evil。example", "evil｡example", "evil․example", "https：／／evil", "evil\\reset",
  ];
  for (const name of badNames) {
    const ctx = make(), invite = await create(ctx), auth = await login(ctx);
    const ownerProfile = ctx.rows.users.find(user => user._id === "U-owner");
    const before = { ...ownerProfile };
    for (const suffix of ["", "Internal"]) {
      await assert.rejects(() => setName(ctx, name, owner, suffix), error => error instanceof ConvexError && /without links/.test(error.data));
    }
    assert.deepEqual(ownerProfile, before);
    // Simulate a previously saved name accepted by the old validator.
    ownerProfile.displayName = name;
    for (const suffix of ["", "Internal"]) {
      await assert.rejects(() => call(`createInvitation${suffix}`, ctx, { ...owner, listId: "L", email: "new@example.test", requestId: "blocked_link_name" }), /Choose and save/);
      await assert.rejects(() => call(`resendInvitation${suffix}`, ctx, { ...manage(invite), requestId: "blocked_link_resend" }), /Choose and save/);
    }
    assert.equal(await call("getInvitation", ctx, { ...invite, ...auth }), null);
    assert.deepEqual(await call("getPendingInvitations", ctx, auth), []);
    assert.equal(await call("deliveryPayload", ctx, invite), null);
    await assert.rejects(() => accept(ctx, invite, auth), unavailable);
    let mailCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { mailCalls++; return { ok: true }; };
    try { await modules.invitationMail.deliver._handler(ctx.action, invite); }
    finally { globalThis.fetch = originalFetch; }
    assert.equal(mailCalls, 0);
    assert.equal(ctx.scheduled.length, 2);
    assert.equal(ctx.rows.listInvitations.length, 1);
    assert.equal(ctx.rows.listInvitations[0].version, 1);
  }
});

test("realistic public names retain punctuation and appear as quoted account attributes in mail", async () => {
  for (const name of ["J. Smith", "J. R. R. Tolkien", "Smith Jr.", "O'Neill", "Anne-Marie O’Connor", "María-José", "李小龍", 'Alex "Ace" Rivera']) {
    const ctx = make();
    await setName(ctx, name);
    const invite = await create(ctx), auth = await login(ctx);
    assert.equal((await call("getInvitation", ctx, { ...invite, ...auth })).inviter, name);
    const originalFetch = globalThis.fetch, originalKey = process.env.RESEND_API_KEY;
    let message;
    process.env.RESEND_API_KEY = "fixture-only";
    globalThis.fetch = async (_url, options) => { message = JSON.parse(options.body); return { ok: true }; };
    try { await modules.invitationMail.deliver._handler(ctx.action, invite); }
    finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
    }
    assert.equal(message.text.split("\n")[0], `An account named ${JSON.stringify(name)} invited you to collaborate on boop.`);
    assert.deepEqual(message.text.match(/https?:\/\/\S+/g), [`https://boop.ad/invitations/${invite.invitationId}/1`]);
    assert.equal(JSON.stringify(message).includes("owner@example.test"), false);
  }
});

test("invalid recipient email and rate limits expose actionable ConvexError strings", async () => {
  const isActionable = expected => error => error instanceof ConvexError && error.data === expected;
  for (const email of ["a@b", "friend@gmailcom", "not an email", `${"a".repeat(250)}@example.test`]) {
    const ctx = make();
    await assert.rejects(() => create(ctx, { email }), isActionable("Enter a valid email address."));
    assert.equal(ctx.scheduled.length, 0);
    assert.equal(ctx.rows.listInvitations, undefined);
  }
  const ctx = make();
  let invite = await create(ctx);
  for (let i = 0; i < 2; i++) invite = await call("resendInvitation", ctx, { ...manage(invite), requestId: `rate_error_${i}` });
  await assert.rejects(() => call("resendInvitation", ctx, { ...manage(invite), requestId: "rate_error_more" }), isActionable("Invitation rate limit reached. Try again later."));
});
