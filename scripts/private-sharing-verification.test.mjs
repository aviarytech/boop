import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { SignJWT } from "jose";
import { pathToFileURL } from "node:url";
import { fixture, credentials, sessions, digest, PRIVATE_SHARING_JWT_SECRET } from "./helpers/private-sharing-fixture.mjs";

// Execute production handlers; only external byte/push delivery is replaced.
// The shared fixture does not simulate Convex validators, OCC or subscriptions.
const names = ["lists", "items", "notes", "listGrants", "invitations", "attachments", "attachmentDownload", "notifications", "notificationActions", "actorSession", "agentReadHttp"];
const effects = globalThis.__privateSharingVerificationEffects = { pushes: [], reads: 0 };
await build({
  entryPoints: names.map(name => `convex/${name}.ts`), outdir: "tmp/private-sharing-verification",
  bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  external: ["convex/*", "@originals/*"],
  define: { "process.env.JWT_SECRET": JSON.stringify(PRIVATE_SHARING_JWT_SECRET), "process.env.CONVEX_SITE_URL": '"https://verification.convex.site"' },
  plugins: [{ name: "verification-external-effects", setup(b) {
    b.onResolve({ filter: /\/lib\/bucket$/ }, () => ({ path: "bucket", namespace: "verification" }));
    b.onResolve({ filter: /^web-push$/ }, () => ({ path: "push", namespace: "verification" }));
    b.onLoad({ filter: /.*/, namespace: "verification" }, ({ path }) => ({ contents: path === "push" ? `
      export const setVapidDetails = () => {};
      export const sendNotification = async (subscription, payload) => { globalThis.__privateSharingVerificationEffects.pushes.push({ subscription, payload }); };
    ` : `
      export const bucketKey = (...parts) => parts.join('/');
      export const getObjectBody = async () => { globalThis.__privateSharingVerificationEffects.reads++; return new Blob(['verification private bytes']); };
      export const presignPut = async () => { throw Error('Unexpected upload'); };
      export const deleteObject = async () => { throw Error('Unexpected deletion'); };
    ` }));
  } }],
});
const modules = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(`${process.cwd()}/tmp/private-sharing-verification/${name}.mjs`))])));
const call = (mod, name, ctx, args = {}) => modules[mod][name]._handler(ctx, args);
function make() {
  effects.pushes = []; effects.reads = 0;
  const ctx = fixture(modules);
  ctx.db.normalizeId = (_table, id) => id.startsWith("listInvitations-") ? id : null;
  ctx.rows.users[0].displayName = "Chosen Owner";
  ctx.rows.users[0].displayNameChosenAt = 1;
  ctx.rows.items[0].attachments = [{ key: "attachments/I/private.png", contentType: "image/png", size: 26, sha256: "private-digest" }];
  return ctx;
}
const forbidden = error => {
  assert.deepEqual(error.data, { kind: "auth", code: "FORBIDDEN", message: "Resource unavailable" });
  return true;
};
const headers = (role, apiKey = false) => role === "anonymous" ? {} : apiKey ? { "X-API-Key": `key-${role}` } : { Authorization: `Bearer ${sessions[role].authToken}` };
const responseValue = async response => ({ status: response.status, body: await response.text(), headers: [...response.headers] });

test("private and absent list HTTP responses are identical for outsiders, pending recipients and anonymous callers", async () => {
  for (const role of ["outsider", "pending", "anonymous"]) for (const key of role === "outsider" ? [false, true] : [false]) {
    const ctx = make();
    const read = id => call("agentReadHttp", "getListWithItems", ctx.action, new Request(`https://fixture.invalid/api/v1/lists/items?listId=${id}`, { headers: headers(role, key) }));
    const privateResponse = await responseValue(await read("L"));
    assert.equal(privateResponse.status, role === "anonymous" ? 401 : 404);
    assert.deepEqual(privateResponse, await responseValue(await read("missing")));
    assert.equal(privateResponse.body.includes("Private list"), false);
    assert.equal(privateResponse.body.includes("Secret item"), false);
  }
});

test("private attachment existence, membership and missing IDs yield identical denied responses without storage reads", async () => {
  const ctx = make();
  for (const role of ["outsider", "pending", "anonymous"]) {
    const responses = [];
    for (const [itemId, key] of [["I", "attachments/I/private.png"], ["I", "attachments/I/missing.png"], ["missing", "attachments/I/private.png"]]) {
      const query = new URLSearchParams({ itemId, key });
      responses.push(await responseValue(await call("attachmentDownload", "download", ctx.action, new Request(`https://verification.convex.site/api/attachments/download?${query}`, { headers: headers(role) }))));
    }
    assert.equal(responses[0].status, 403);
    assert.deepEqual(responses[0], responses[1]);
    assert.deepEqual(responses[0], responses[2]);
  }
  assert.equal(effects.reads, 0);
});

test("API discovery requires lists:read and removes revoked titles even with historical bookmarks", async () => {
  const ctx = make();
  const key = ctx.rows.agentApiKeys.find(row => row._id === "KEY-viewer");
  for (const suffix of ["", "Internal"]) {
    key.scopes = ["items:read"];
    await assert.rejects(() => call("listGrants", "getSharedWithMe" + suffix, ctx, { apiKey: "key-viewer" }), /Missing scope/);
    key.scopes = ["lists:read"];
    const discovered = await call("listGrants", "getSharedWithMe" + suffix, ctx, { apiKey: "key-viewer" });
    assert.deepEqual(discovered.map(row => row.listId).sort(), ["L", "N"]);
    for (const row of discovered) assert.deepEqual(Object.keys(row).sort(), ["acceptedAt", "kind", "listId", "name", "owner", "published", "role"]);
  }
  const request = () => new Request("https://fixture.invalid/api/v1/lists", { headers: headers("viewer", true) });
  assert.equal((await (await call("agentReadHttp", "getLists", ctx.action, request())).json()).lists.length, 2);
  ctx.rows.bookmarks.push({ _id: "stale", listId: "L", userDid: "did:viewer" });
  await call("listGrants", "revokeListGrant", ctx, { ...credentials("owner"), listId: "L", grantId: "G-L-viewer" });
  const after = await (await call("agentReadHttp", "getLists", ctx.action, request())).json();
  assert.deepEqual(after.lists.map(row => row._id), ["N"]);
  assert.equal(JSON.stringify(after).includes("Private list"), false);
  assert.deepEqual((await call("listGrants", "getSharedWithMe", ctx, { apiKey: "key-viewer" })).map(row => row.listId), ["N"]);
});

for (const listId of ["L", "N"]) test(`${listId}: invitation preview, inbox and mail omit resource metadata until explicit acceptance`, async () => {
  const ctx = make();
  const locator = await call("invitations", "createInvitation", ctx, { ...credentials("owner"), listId, email: "pending@example.test", requestId: `verification-${listId}` });
  // Shared role fixtures intentionally all sign fixture@example.test; invitation
  // acceptance needs a distinct verified mailbox, not the profile email field.
  const authToken = await new SignJWT({ email: "pending@example.test" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(sessions.pending.user.turnkeySubOrgId)
    .setIssuer("originals-auth").setAudience("originals-api").setExpirationTime("1h")
    .sign(new TextEncoder().encode(PRIVATE_SHARING_JWT_SECRET));
  ctx.rows.accessSessions.push({ _id: "verified-pending", tokenHash: digest(authToken), subject: sessions.pending.user.turnkeySubOrgId });
  const auth = { authToken };
  const preview = await call("invitations", "getInvitation", ctx, { ...locator, ...auth });
  assert.deepEqual(Object.keys(preview).sort(), ["expiresAt", "invitationId", "inviter", "role", "version"]);
  assert.equal(preview.inviter, "Chosen Owner");
  assert.equal(preview.role, "viewer");
  assert.deepEqual(await call("invitations", "getPendingInvitations", ctx, auth), [preview]);
  assert.deepEqual(await call("invitations", "deliveryPayload", ctx, locator), { email: "pending@example.test", inviter: "Chosen Owner" });
  assert.deepEqual(await call("listGrants", "getSharedWithMe", ctx, auth), []);
  assert.equal(await call("lists", "getList", ctx, { ...auth, listId }), null);
  assert.equal(await call("invitations", "getInvitation", ctx, { ...locator, ...credentials("outsider") }), null);
  const accepted = await call("invitations", "acceptInvitation", ctx, { ...locator, ...auth, accept: true });
  assert.equal(accepted.listId, listId);
  const [resource] = await call("listGrants", "getSharedWithMe", ctx, auth);
  assert.equal(resource.name, ctx.rows.lists.find(row => row._id === listId).name);
  assert.equal(resource.kind, listId === "N" ? "note" : "list");
  await call("listGrants", "revokeListGrant", ctx, { ...credentials("owner"), listId, grantId: accepted.grantId });
  assert.deepEqual(await call("listGrants", "getSharedWithMe", ctx, auth), []);
  assert.equal(await call("lists", "getList", ctx, { ...auth, listId }), null);
});

test("grant ID substitution across two owned resources fails without mutations for direct and internal operations", async () => {
  for (const suffix of ["", "Internal"]) for (const operation of ["updateListGrant", "revokeListGrant"]) {
    const ctx = make(); const before = structuredClone(ctx.rows);
    await assert.rejects(() => call("listGrants", operation + suffix, ctx, { ...credentials("owner"), listId: "L", grantId: "G-N-viewer", ...(operation === "updateListGrant" ? { role: "editor" } : {}) }), forbidden);
    assert.deepEqual(ctx.rows, before);
    assert.deepEqual(ctx.scheduled, []);
  }
});

test("scheduled push dispatch rechecks grants: revoked and pending recipients and stale bookmarks receive no private payload", async () => {
  const ctx = make();
  for (const role of ["owner", "editor", "viewer", "outsider", "pending"]) {
    ctx.rows.pushTokens.push({ _id: `push-${role}`, userDid: `did:${role}`, platform: "web", token: `https://push.invalid/${role}`, webPushKeys: { p256dh: "fixture", auth: "fixture" } });
    ctx.rows.bookmarks.push({ _id: `bookmark-${role}`, userDid: `did:${role}`, listId: "L" });
  }
  const notification = { listId: "L", title: "Private list", body: "Secret item", data: { itemId: "I" } };
  await call("notificationActions", "sendListNotificationInternal", ctx.action, notification);
  assert.deepEqual(effects.pushes.map(row => row.subscription.endpoint).sort(), ["editor", "owner", "viewer"].map(role => `https://push.invalid/${role}`));
  assert.ok(effects.pushes.every(row => JSON.parse(row.payload).body === "Secret item"));
  effects.pushes = [];
  await call("listGrants", "revokeListGrant", ctx, { ...credentials("owner"), listId: "L", grantId: "G-L-viewer" });
  await call("notificationActions", "sendListNotificationInternal", ctx.action, notification);
  assert.deepEqual(effects.pushes.map(row => row.subscription.endpoint).sort(), ["https://push.invalid/editor", "https://push.invalid/owner"]);
  effects.pushes = [];
  await call("notificationActions", "sendPushNotificationInternal", ctx.action, { ...notification, userDid: "did:viewer" });
  assert.deepEqual(effects.pushes, []);
});
