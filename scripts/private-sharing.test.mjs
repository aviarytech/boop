import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { fixture, sessions, credentials, digest, PRIVATE_SHARING_JWT_SECRET } from "./helpers/private-sharing-fixture.mjs";

const names = ["lists", "notes", "items", "publication", "didResources", "attachments", "activity", "comments", "tags", "presence", "assignees", "itemCategories", "categories", "bitcoinAnchors", "listGrants", "lib/listGrants", "actorSession", "notifications", "notificationActions", "users", "agentReadHttp", "itemsHttp", "listsHttp", "didResourcesHttp", "didLogs"];
const bucket = globalThis.__privateSharingBucket = { calls: [], afterDelete: null };
await build({
  entryPoints: names.map(name => `convex/${name}.ts`), outdir: "tmp/private-sharing-test",
  bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  define: { "process.env.JWT_SECRET": JSON.stringify(PRIVATE_SHARING_JWT_SECRET) },
  external: ["convex/*", "@originals/*", "@turnkey/*", "web-push"],
  plugins: [{ name: "no-live-storage", setup(builder) {
    builder.onResolve({ filter: /^\.\/lib\/bucket$/ }, () => ({ path: "bucket", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      const state = globalThis.__privateSharingBucket;
      export const bucketKey = (...parts) => parts.join('/');
      export const presignPut = async key => { state.calls.push(['put', key]); return 'https://fixture.invalid/upload'; };
      export const presignGet = async key => { state.calls.push(['get', key]); return 'https://fixture.invalid/read'; };
      export const deleteObject = async key => { state.calls.push(['delete', key]); await state.afterDelete?.(); };
    ` }));
  } }],
});
const modules = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(`${process.cwd()}/tmp/private-sharing-test/${name}.mjs`))])));
const make = options => { bucket.calls = []; bucket.afterDelete = null; return fixture(modules, options); };
const call = (module, operation, ctx, args = {}) => modules[module][operation]._handler(ctx, args);
const denied = error => {
  assert.deepEqual(error.data, { kind: "auth", code: "FORBIDDEN", message: "Resource unavailable" });
  return true;
};
const authDenied = /Authentication required|token/i;
const roles = ["owner", "editor", "viewer", "outsider", "pending", "anonymous"];
const readers = new Set(["owner", "editor", "viewer"]);
const editors = new Set(["owner", "editor"]);
const attachment = { key: "attachments/I/file.png", contentType: "image/png", size: 10, sha256: "abc" };
const copyArgs = { sourceListId: "L", name: "My copy", assetDid: "did:cel:copy", celEnvelope: '{"format":"originals/asset"}', createdAt: 10 };

const readOperations = [
  ["lists", "getListEnvelope", { listId: "L" }],
  ["lists", "getLegacyListIds", { listIds: ["L"] }],
  ["items", "getListItems", { listId: "L" }],
  ["items", "getItemForSync", { itemId: "I" }],
  ["items", "getSubItems", { parentId: "I" }],
  ["items", "getItemsWithDueDates", { listId: "L" }],
  ["attachments", "getAttachmentUrls", { itemId: "I" }],
  ["activity", "getListActivity", { listId: "L" }],
  ["comments", "getItemComments", { itemId: "I" }],
  ["comments", "getCommentCount", { itemId: "I" }],
  ["tags", "getListTags", { listId: "L" }],
  ["presence", "getListPresence", { listId: "L" }],
  ["assignees", "getItemAssignees", { itemId: "I" }],
  ["bitcoinAnchors", "getListDataForAnchor", { listId: "L" }],
  ["bitcoinAnchors", "getListAnchors", { listId: "L" }],
  ["bitcoinAnchors", "getItemAnchors", { itemId: "I" }],
  ["bitcoinAnchors", "getLatestAnchor", { listId: "L" }],
  ["bitcoinAnchors", "getAnchor", { anchorId: "ANCHOR" }],
  ["listGrants", "getMyListAccess", { listId: "L" }],
];

for (const role of roles) test(`${role}: direct and internal reads protect list/item metadata and attachments`, async () => {
  for (const [module, name, args] of readOperations) for (const suffix of ["", "Internal"]) {
    const ctx = make(); ctx.rows.items[0].attachments = [attachment];
    const invoke = () => call(module, name + suffix, ctx, { ...args, ...credentials(role) });
    if (readers.has(role)) assert.notEqual(await invoke(), null, `${module}.${name}`);
    else await assert.rejects(invoke, role === "anonymous" ? authDenied : denied, `${module}.${name}`);
    if (!readers.has(role)) assert.deepEqual(bucket.calls, []);
  }
});

for (const role of roles) test(`${role}: list/note bodies, cards, editor previews, discovery and subscription reruns`, async () => {
  const ctx = make();
  for (const listId of ["L", "N"]) {
    if (role === "anonymous") await assert.rejects(() => call("lists", "getList", ctx, { listId }), authDenied);
    else assert.equal((await call("lists", "getList", ctx, { listId, ...credentials(role) }))?._id ?? null, readers.has(role) ? listId : null);
  }
  for (const suffix of ["", "Internal"]) {
    const invoke = () => call("notes", "getNoteBody" + suffix, ctx, { listId: "N", ...credentials(role) });
    if (role === "anonymous") await assert.rejects(invoke, authDenied);
    else {
      const result = await invoke();
      if (readers.has(role)) { assert.equal(result.body, "Private note body"); assert.equal(result.canEdit, editors.has(role)); }
      else assert.equal(result, null);
    }
  }
  if (role === "anonymous") return;
  const cards = await call("notes", "getNoteCards", ctx, { listIds: ["N", "X", "missing"], ...credentials(role) });
  assert.equal(cards.length, readers.has(role) ? 1 : 0);
  const preview = await call("items", "getItemForEditor", ctx, { itemId: "I", ...credentials(role) });
  assert.equal(preview?.name ?? null, readers.has(role) ? "Secret item" : null);
  if (preview) assert.equal(preview.canEdit, editors.has(role));
  const lists = await call("lists", "getUserLists", ctx, credentials(role));
  assert.equal(lists.some(l => l._id === "L"), readers.has(role));
  assert.equal(lists.some(l => l._id === "N"), readers.has(role));
  const priority = await call("items", "getHighPriorityItems", ctx, credentials(role));
  assert.equal(priority.some(row => row.listId === "L"), readers.has(role));
  const replay = () => call("items", "getListItemsForReplay", ctx, { listId: "L", operationIds: [], ...credentials(role) });
  if (readers.has(role)) assert.equal((await replay()).items[0].name, "Secret item");
  else await assert.rejects(replay, denied);
});

const contentWrites = [
  ["items", "addItem", { listId: "L", name: "New", createdAt: 3 }],
  ["items", "updateItem", { itemId: "I", name: "Changed", description: "changed" }],
  ["items", "checkItem", { itemId: "I", checkedAt: 3 }],
  ["items", "uncheckItem", { itemId: "I" }],
  ["items", "removeItem", { itemId: "I" }],
  ["items", "reorderItems", { listId: "L", itemIds: ["CHILD", "I"] }],
  ["items", "setAisleOverride", { itemId: "I", aisleId: "produce" }],
  ["items", "batchCheckItems", { itemIds: ["I"], checkedAt: 3 }],
  ["items", "batchUncheckItems", { itemIds: ["I"] }],
  ["items", "batchDeleteItems", { itemIds: ["I"] }],
  ["items", "promoteItem", { itemId: "CHILD" }],
  ["items", "demoteItem", { itemId: "IX", newParentId: "I" }, "cross"],
  ["notes", "updateNoteBody", { listId: "N", body: "Changed note", expectedBody: "Private note body" }],
  ["didResources", "checkSharedItem", { listId: "L", itemId: "I" }],
  ["didResources", "uncheckSharedItem", { listId: "L", itemId: "I" }],
  ["comments", "addComment", { itemId: "I", text: "New comment" }],
  ["comments", "deleteComment", { commentId: "COMMENT" }],
  ["tags", "createTag", { listId: "L", name: "New tag", color: "blue" }],
  ["tags", "updateTag", { tagId: "T", name: "Updated" }],
  ["tags", "deleteTag", { tagId: "T" }],
  ["tags", "addTagToItem", { itemId: "CHILD", tagId: "T" }],
  ["tags", "removeTagFromItem", { itemId: "I", tagId: "T" }],
  ["itemCategories", "addListCategory", { listId: "L", name: "New category", emoji: "a" }],
  ["presence", "heartbeat", { listId: "L" }],
  ["presence", "markOffline", { listId: "L" }],
  ["activity", "recordActivity", { listId: "L", itemId: "I", type: "item_updated" }],
  ["attachments", "addAttachment", { itemId: "I", bucketKey: attachment.key, contentType: attachment.contentType, size: 10, sha256: "abc" }],
];

for (const role of roles) test(`${role}: direct/legacy and internal content writes require owner or accepted editor`, async () => {
  for (const [module, name, args, cross] of contentWrites) for (const suffix of ["", "Internal"]) {
    const ctx = make();
    const before = structuredClone(ctx.rows);
    const invoke = () => call(module, name + suffix, ctx, { ...args, ...credentials(role) });
    if (editors.has(role) && !cross) await invoke();
    else {
      await assert.rejects(invoke, role === "anonymous" ? authDenied : denied, `${module}.${name}`);
      assert.deepEqual(ctx.rows, before, `${module}.${name} wrote despite denial`);
    }
  }
});

const ownerWrites = [
  ["lists", "renameList", { listId: "L", name: "Renamed" }],
  ["lists", "renameList", { listId: "N", name: "Renamed note" }],
  ["lists", "deleteList", { listId: "L" }],
  ["lists", "deleteList", { listId: "N" }],
  ["lists", "updateListCategory", { listId: "L" }],
  ["categories", "setListCategory", { listId: "L" }],
  ["lists", "updateItemViewMode", { listId: "L", itemViewMode: "alphabetical" }],
  ["lists", "addCustomAisle", { listId: "L", name: "New", emoji: "a" }],
  ["lists", "removeCustomAisle", { listId: "L", aisleId: "a" }],
  ["publication", "publishList", { listId: "L", webvhDid: "did:webvh:public", celEnvelope: "new-owner-envelope" }],
  ["publication", "unpublishList", { listId: "L" }],
  ["bitcoinAnchors", "createAnchorRecord", { listId: "L", stateHash: "hash", stateSnapshot: "snapshot" }],
  ["bitcoinAnchors", "updateAnchorStatus", { anchorId: "ANCHOR", status: "confirmed" }],
  ["listGrants", "updateListGrant", { listId: "L", grantId: "G-L-viewer", role: "editor" }],
  ["listGrants", "revokeListGrant", { listId: "L", grantId: "G-L-viewer" }],
];
for (const role of roles) test(`${role}: owner-only metadata, publishing/envelopes, anchoring and grant management`, async () => {
  for (const [module, name, args] of ownerWrites) for (const suffix of ["", "Internal"]) {
    const ctx = make({ published: name === "unpublishList" });
    const before = structuredClone(ctx.rows);
    const invoke = () => call(module, name + suffix, ctx, { ...args, ...credentials(role) });
    if (role === "owner") await invoke();
    else {
      await assert.rejects(invoke, role === "anonymous" ? authDenied : denied, `${module}.${name}`);
      assert.deepEqual(ctx.rows, before);
    }
  }
});

test("public reads remain public; bookmarks and historical authors are never edit grants", async () => {
  const ctx = make({ published: true });
  ctx.rows.bookmarks.push({ _id: "BOOK", listId: "L", userDid: "did:outsider" });
  ctx.rows.items[0].createdByDid = "did:outsider";
  assert.ok(await call("publication", "getPublicList", ctx, { webvhDid: "did:webvh:public" }));
  assert.ok(await call("didResources", "getListById", ctx, { listId: "L" }));
  assert.equal((await call("didResources", "getPublicListItems", ctx, { listId: "L" })).length, 1);
  for (const role of ["outsider", "pending", "viewer"]) {
    assert.ok(await call("lists", "getList", ctx, { listId: "L", ...credentials(role) }));
    await call("publication", "bookmarkList", ctx, { listId: "L", ...credentials(role) });
    for (const [module, name, args] of contentWrites.filter(([, , args]) => args.listId !== "N")) {
      await assert.rejects(() => call(module, name, ctx, { ...args, ...credentials(role) }), denied);
    }
  }
  await call("publication", "unpublishList", ctx, { listId: "L", ...credentials("owner") });
  assert.equal(await call("lists", "getList", ctx, { listId: "L", ...credentials("outsider") }), null);
  assert.equal(await call("didResources", "getListById", ctx, { listId: "L" }), null);
  assert.ok(await call("lists", "getList", ctx, { listId: "L", ...credentials("viewer") }), "accepted private access survives unpublish");
  await call("items", "checkItem", ctx, { itemId: "I", checkedAt: 4, ...credentials("editor") });
  assert.equal(ctx.rows.items[0].checkedByDid, "did:editor");
});

test("grant downgrade/revocation changes subsequent live-query handler results and denies fresh replay writes", async () => {
  const ctx = make();
  const editor = credentials("editor");
  assert.ok(await call("lists", "getList", ctx, { listId: "L", ...editor }));
  assert.ok(ctx.reads.some(r => r.table === "listGrants" && r.index === "by_list_recipient"));
  await call("listGrants", "updateListGrant", ctx, { listId: "L", grantId: "G-L-editor", role: "viewer", ...credentials("owner") });
  assert.equal((await call("items", "getItemForEditor", ctx, { itemId: "I", ...editor })).canEdit, false);
  await assert.rejects(() => call("items", "checkItem", ctx, { itemId: "I", checkedAt: 3, ...editor }), denied);
  await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: "G-L-editor", ...credentials("owner") });
  for (const [module, name, args] of readOperations) await assert.rejects(() => call(module, name, ctx, { ...args, ...editor }), denied);
  assert.equal(await call("lists", "getList", ctx, { listId: "L", ...editor }), null);
  assert.equal((await call("lists", "getUserLists", ctx, editor)).some(l => l._id === "L"), false);
  assert.deepEqual(await call("items", "getHighPriorityItems", ctx, editor), []);
  await assert.rejects(() => call("items", "checkItemReplay", ctx, {
    itemId: "I", checkedAt: 3, ...editor,
    replay: { operationId: "queued-before-revoke", accountId: sessions.editor.user.turnkeySubOrgId, expected: [{ id: "I", revision: "stale" }] },
  }), denied, "authorization must precede revision/conflict disclosure");
  assert.equal(ctx.rows.items[0].checked, false);
});

test("note body and summary subscriptions drop private data after revocation", async () => {
  const ctx = make(); const viewer = credentials("viewer");
  assert.equal((await call("notes", "getNoteBody", ctx, { listId: "N", ...viewer })).body, "Private note body");
  await call("listGrants", "revokeListGrant", ctx, { listId: "N", grantId: "G-N-viewer", ...credentials("owner") });
  assert.equal(await call("notes", "getNoteBody", ctx, { listId: "N", ...viewer }), null);
  assert.deepEqual(await call("notes", "getNoteCards", ctx, { listIds: ["N"], ...viewer }), []);
});

test("private missing/denied aliases and txid lookups have indistinguishable responses", async () => {
  const ctx = make(); const auth = credentials("outsider");
  for (const id of ["L", "missing"]) {
    assert.equal(await call("lists", "getList", ctx, { listId: id, ...auth }), null);
    assert.equal(await call("publication", "getPublicationStatus", ctx, { listId: id, ...auth }), null);
    assert.equal(await call("didResources", "getListById", ctx, { listId: id }), null);
    assert.deepEqual(await call("didResources", "getPublicListItems", ctx, { listId: id }), []);
  }
  for (const txid of ["tx", "missing"]) assert.equal(await call("bitcoinAnchors", "getAnchorByTxid", ctx, { txid, ...auth }), null);
  for (const tagId of ["T", "missing"]) for (const name of ["updateTag", "deleteTag"])
    await assert.rejects(() => call("tags", name, ctx, { tagId, ...auth }), denied);
  for (const commentId of ["COMMENT", "missing"]) await assert.rejects(() => call("comments", "deleteComment", ctx, { commentId, ...auth }), denied);
  assert.deepEqual(await call("bitcoinAnchors", "getPendingAnchors", ctx, auth), []);
});

test("cross-resource substitution fails even when both lists are editable", async () => {
  const ctx = make(); ctx.rows.lists.find(l => l._id === "X").ownerDid = "did:owner";
  const before = structuredClone(ctx.rows);
  const cases = [
    ["activity", "recordActivity", { listId: "L", itemId: "IX", type: "item_updated" }],
    ["didResources", "checkSharedItem", { listId: "L", itemId: "IX" }],
    ["didResources", "uncheckSharedItem", { listId: "L", itemId: "IX" }],
    ["items", "addItem", { listId: "L", parentId: "IX", name: "Cross child", createdAt: 4 }],
    ["items", "demoteItem", { itemId: "I", newParentId: "IX" }],
    ["items", "reorderItems", { listId: "L", itemIds: ["I", "IX"] }],
    ["listGrants", "updateListGrant", { listId: "N", grantId: "G-L-editor", role: "viewer" }],
    ["listGrants", "revokeListGrant", { listId: "N", grantId: "G-L-editor" }],
  ];
  for (const [module, name, args] of cases) {
    await assert.rejects(() => call(module, name, ctx, { ...args, ...credentials("owner") }), denied, `${module}.${name}`);
    assert.deepEqual(ctx.rows, before);
  }
  await assert.rejects(() => call("tags", "addTagToItem", ctx, { itemId: "IX", tagId: "T", ...credentials("owner") }), /different list/);
  assert.deepEqual(ctx.rows, before);
});

for (const role of roles) test(`${role}: attachment actions and their internal checkpoints recheck edit authority`, async () => {
  for (const name of ["generateUploadUrl", "removeAttachment"]) for (const suffix of ["", "Internal"]) {
    const ctx = make(); ctx.rows.items[0].attachments = [attachment];
    const args = name === "generateUploadUrl" ? { itemId: "I", contentType: "image/png", byteLength: 10 } : { itemId: "I", bucketKey: attachment.key };
    const invoke = () => call("attachments", name + suffix, ctx.action, { ...args, ...credentials(role) });
    if (editors.has(role)) { await invoke(); assert.equal(bucket.calls.length, 1); }
    else { await assert.rejects(invoke, role === "anonymous" ? authDenied : denied); assert.deepEqual(bucket.calls, []); }
  }
  for (const name of ["assertItemEditable", "dropAttachment"]) {
    const ctx = make(); ctx.rows.items[0].attachments = [attachment];
    const invoke = () => call("attachments", name, ctx, { itemId: "I", bucketKey: attachment.key, ...credentials(role) });
    if (editors.has(role)) await invoke();
    else await assert.rejects(invoke, role === "anonymous" ? authDenied : denied);
  }
});

test("attachment ID/key substitution and historical shared keys cannot delete another item's bytes", async () => {
  const ctx = make(); ctx.rows.items[0].attachments = [attachment];
  for (const role of ["owner", "editor"]) {
    await assert.rejects(() => call("attachments", "removeAttachment", ctx.action, { itemId: "I", bucketKey: "attachments/IX/secret", ...credentials(role) }), denied);
    await assert.rejects(() => call("attachments", "addAttachment", ctx, { itemId: "I", bucketKey: "attachments/IX/secret", contentType: "image/png", size: 1, sha256: "x", ...credentials(role) }), /Invalid attachment key/);
    await assert.rejects(() => call("attachments", "getAttachmentUrls", ctx, { itemId: "IX", ...credentials(role) }), denied);
  }
  ctx.rows.items[0].attachments = [{ ...attachment, key: "attachments/IX/secret" }];
  await assert.rejects(() => call("attachments", "removeAttachment", ctx.action, { itemId: "I", bucketKey: "attachments/IX/secret", ...credentials("owner") }), denied);
  assert.deepEqual(bucket.calls, []);
});

test("attachment action limitation: a revocation after storage deletion prevents final metadata write, not the storage side effect", async () => {
  const ctx = make(); ctx.rows.items[0].attachments = [attachment];
  bucket.afterDelete = async () => {
    await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: "G-L-editor", ...credentials("owner") });
  };
  await assert.rejects(() => call("attachments", "removeAttachment", ctx.action, { itemId: "I", bucketKey: attachment.key, ...credentials("editor") }), denied);
  assert.deepEqual(bucket.calls, [["delete", attachment.key]]);
  assert.equal(ctx.rows.items[0].attachments.length, 1);
  // Deliberately records an unresolved #260/action-boundary limit, not atomic revocation.
});

test("API scopes intersect current grants for direct, internal and action operations", async () => {
  for (const role of ["owner", "editor", "viewer", "outsider"]) {
    const ctx = make(); const apiKey = `key-${role}`;
    for (const suffix of ["", "Internal"]) {
      const read = () => call("items", "getListItems" + suffix, ctx, { apiKey, listId: "L" });
      if (role !== "outsider") await read(); else await assert.rejects(read, denied);
      const write = () => call("items", "checkItem" + suffix, ctx, { apiKey, itemId: "I", checkedAt: 4 });
      if (editors.has(role)) await write(); else await assert.rejects(write, denied);
    }
    const key = ctx.rows.agentApiKeys.find(k => k._id === `KEY-${role}`);
    key.scopes = ["lists:read", "items:read"];
    await assert.rejects(() => call("items", "checkItem", ctx, { apiKey, itemId: "I", checkedAt: 4 }), /Missing scope/);
    await assert.rejects(() => call("attachments", "generateUploadUrl", ctx.action, { apiKey, itemId: "I", contentType: "image/png", byteLength: 10 }), /Missing scope/);
    key.scopes = ["items:write"];
    await assert.rejects(() => call("items", "getListItems", ctx, { apiKey, listId: "L" }), /Missing scope/);
    key.revokedAt = Date.now();
    await assert.rejects(() => call("items", "checkItemInternal", ctx, { apiKey, itemId: "I", checkedAt: 4 }), /Invalid API key/);
  }
  const ctx = make({ published: true });
  await assert.rejects(() => call("didResources", "checkSharedItem", ctx, { apiKey: "key-outsider", listId: "L", itemId: "I" }), denied);
  await assert.rejects(() => call("bitcoinAnchors", "anchorListState", ctx.action, { listId: "L", ...credentials("editor") }), denied);
  // Even a successful initial action auth cannot bypass a scope change at its database checkpoint.
  await assert.rejects(() => call("actorSession", "authorize", ctx, { apiKey: "key-viewer", authority: "edit", scope: "items:write", resources: { lists: ["L"] } }), denied);
});

test("accepted account grants survive recipient/owner DID migration; no identity assertions confer grants", async () => {
  const ctx = make();
  ctx.rows.users.find(u => u._id === "U-owner").legacyDid = "did:old-owner";
  ctx.rows.lists[0].ownerDid = "did:old-owner";
  const editor = ctx.rows.users.find(u => u._id === "U-editor");
  editor.legacyDid = "did:editor"; editor.did = "did:new-editor";
  await call("items", "checkItem", ctx, { apiKey: "key-editor", itemId: "I", checkedAt: 4 });
  assert.equal(ctx.rows.items[0].checkedByDid, "did:new-editor");
  await call("lists", "renameList", ctx, { ...credentials("owner"), listId: "L", name: "Still mine" });
  for (const field of ["userDid", "legacyDid", "ownerDid"]) await assert.rejects(() => call("items", "checkItem", ctx, { ...credentials("outsider"), itemId: "I", checkedAt: 4, [field]: "did:new-editor" }), /assertion/);
});

test("recipient roster is owner-only; own access reveals only owner and own role; owner cannot self-demote", async () => {
  const ctx = make();
  assert.equal((await call("listGrants", "getListGrants", ctx, { listId: "L", ...credentials("owner") })).length, 2);
  for (const role of ["editor", "viewer"]) {
    await assert.rejects(() => call("listGrants", "getListGrants", ctx, { listId: "L", ...credentials(role) }), denied);
    assert.deepEqual(await call("listGrants", "getMyListAccess", ctx, { listId: "L", ...credentials(role) }), { ownerDid: "did:owner", role });
  }
  ctx.rows.listGrants.push({ _id: "bad-self", listId: "L", recipientId: "U-owner", role: "viewer", acceptedAt: 1 });
  for (const name of ["updateListGrant", "revokeListGrant"]) await assert.rejects(() => call("listGrants", name, ctx, { listId: "L", grantId: "bad-self", role: "viewer", ...credentials("owner") }), denied);
  assert.equal((await call("listGrants", "getMyListAccess", ctx, { listId: "L", ...credentials("owner") })).role, "owner");
});

test("acceptance seam is unregistered, validates current accounts/owner, and never overwrites an existing role", async () => {
  const record = modules["lib/listGrants"].recordAcceptedListGrant;
  assert.equal(record._handler, undefined);
  const ctx = make();
  assert.equal(await call("lists", "getList", ctx, { listId: "L", ...credentials("pending") }), null);
  for (const args of [
    { listId: "L", ownerId: "U-outsider", recipientId: "U-pending", role: "editor" },
    { listId: "L", ownerId: "U-owner", recipientId: "U-owner", role: "editor" },
    { listId: "L", ownerId: "U-owner", recipientId: "U-editor", role: "viewer" },
  ]) await assert.rejects(() => record(ctx, args), denied);
  await record(ctx, { listId: "L", ownerId: "U-owner", recipientId: "U-pending", role: "viewer" });
  assert.ok(await call("lists", "getList", ctx, { listId: "L", ...credentials("pending") }));
  await assert.rejects(() => call("items", "checkItem", ctx, { itemId: "I", checkedAt: 5, ...credentials("pending") }), denied);
  assert.equal(ctx.rows.listGrants.find(g => g._id === "G-L-editor").role, "editor");
  ctx.rows.users.find(u => u._id === "U-outsider").deletionRequestedAt = 5;
  await assert.rejects(() => record(ctx, { listId: "L", ownerId: "U-owner", recipientId: "U-outsider", role: "viewer" }), denied);
});

test("notification generation rechecks current view access at scheduled-send lookup, including unpublished bookmarks", async () => {
  const ctx = make({ published: true });
  ctx.rows.pushTokens = ["owner", "editor", "viewer", "outsider", "pending"].map(role => ({ _id: `TOK-${role}`, userDid: `did:${role}`, token: role, platform: "web" }));
  ctx.rows.bookmarks = ["outsider", "pending"].map(role => ({ _id: `BM-${role}`, listId: "L", userDid: `did:${role}` }));
  const tokens = async () => (await call("notifications", "getTokensForList", ctx, { listId: "L" })).map(t => t.token).sort();
  assert.deepEqual(await tokens(), ["editor", "outsider", "owner", "pending", "viewer"]);
  await call("publication", "unpublishList", ctx, { listId: "L", ...credentials("owner") });
  assert.deepEqual(await tokens(), ["editor", "owner", "viewer"]);
  await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: "G-L-viewer", ...credentials("owner") });
  assert.deepEqual(await tokens(), ["editor", "owner"]);
  assert.deepEqual(await call("notifications", "getTokensForUser", ctx, { listId: "L", userDid: "did:outsider" }), []);
  assert.deepEqual(await call("notifications", "getTokensForUser", ctx, { listId: "L", userDid: "did:viewer" }), []);
  ctx.rows.users.find(u => u._id === "U-owner").deletionRequestedAt = 5;
  assert.deepEqual(await tokens(), []);
});

test("viewer/editor personal copies are private, remap tags, survive source revocation/deletion, and never mutate the original", async () => {
  for (const role of ["owner", "editor", "viewer"]) {
    const ctx = make({ published: true }); ctx.rows.items[0].attachments = [];
    const source = structuredClone(ctx.rows.lists[0]);
    const sourceItems = structuredClone(ctx.rows.items.filter(i => i.listId === "L"));
    const result = await call("lists", "copyList", ctx, { ...copyArgs, ...credentials(role) });
    const copy = ctx.rows.lists.find(l => l._id === result.listId);
    assert.equal(copy.ownerDid, `did:${role}`);
    assert.equal(copy.assetDid, "did:cel:copy");
    if (role !== "owner") assert.equal(copy.categoryId, undefined);
    assert.equal(ctx.rows.publications.some(p => p.listId === copy._id), false);
    assert.equal(ctx.rows.listGrants.some(g => g.listId === copy._id), false);
    assert.deepEqual(ctx.rows.lists.find(l => l._id === "L"), source);
    assert.deepEqual(ctx.rows.items.filter(i => i.listId === "L"), sourceItems);
    const copiedItems = ctx.rows.items.filter(i => i.listId === copy._id);
    assert.equal(copiedItems.length, 2);
    const copiedParent = copiedItems.find(i => i.name === "Secret item");
    assert.notEqual(copiedParent.tags[0], "T");
    assert.equal(ctx.rows.tags.find(t => t._id === copiedParent.tags[0]).listId, copy._id);
    assert.equal(copiedItems.find(i => i.name === "Child").parentId, copiedParent._id);
    assert.equal(copiedParent.vcProofs, undefined);
    if (role !== "owner") await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: `G-L-${role}`, ...credentials("owner") });
    await call("lists", "deleteList", ctx, { listId: "L", ...credentials("owner") });
    assert.equal((await call("items", "getListItems", ctx, { listId: copy._id, ...credentials(role) })).length, 2);
    await call("tags", "updateTag", ctx, { tagId: copiedParent.tags[0], name: "Independent", ...credentials(role) });
  }
});

test("attachment-copy guard rejects object, legacy and mixed arrays before destination/envelope/reward writes; notes remain unsupported", async () => {
  for (const attachments of [[attachment], ["legacy-storage-id"], ["legacy-storage-id", attachment]]) {
    const ctx = make(); ctx.rows.items[0].attachments = attachments;
    ctx.rows.referrals.push({ _id: "REF", refereeId: "U-viewer", referrerId: "U-owner" });
    const before = structuredClone(ctx.rows);
    await assert.rejects(() => call("lists", "copyList", ctx, { ...copyArgs, ...credentials("viewer") }), /Copying lists with attachments is not supported yet.*Export attachments separately/);
    assert.deepEqual(ctx.rows, before);
    assert.deepEqual(ctx.scheduled, []);
    assert.deepEqual(bucket.calls, []);
  }
  const ctx = make();
  await assert.rejects(() => call("lists", "copyList", ctx, { ...copyArgs, sourceListId: "N", ...credentials("viewer") }), /Notes cannot be copied/);
  await assert.rejects(() => call("lists", "copyList", ctx, { ...copyArgs, ...credentials("outsider") }), denied);
});

test("resource deletion and bounded account erasure clean accepted grants without transferring resource ownership", async () => {
  const resource = make();
  await call("lists", "deleteList", resource, { listId: "N", ...credentials("owner") });
  assert.equal(resource.rows.listGrants.some(g => g.listId === "N"), false);
  assert.equal(resource.rows.listGrants.filter(g => g.listId === "L").length, 2);
  for (const role of ["viewer", "owner"]) {
    const ctx = make();
    await call("users", "deleteUserData", ctx, { userId: `U-${role}`, ...credentials(role) });
    if (role === "owner") {
      assert.equal(await call("lists", "getList", ctx, { listId: "L", ...credentials("editor") }), null);
      await assert.rejects(() => call("items", "checkItem", ctx, { itemId: "I", checkedAt: 3, ...credentials("editor") }), denied);
    }
    for (let n = 0; n < 100 && ctx.rows.users.some(u => u._id === `U-${role}`); n++)
      await call("users", "continueUserDeletion", ctx, { userId: `U-${role}` });
    assert.equal(ctx.rows.users.some(u => u._id === `U-${role}`), false);
    assert.equal(ctx.rows.listGrants.some(g => g.recipientId === `U-${role}`), false);
    if (role === "owner") assert.deepEqual(ctx.rows.listGrants, []);
    else assert.equal(ctx.rows.lists.find(l => l._id === "L").ownerDid, "did:owner");
    assert.equal(ctx.rows.lists.find(l => l._id === "X").ownerDid, "did:outsider");
  }
});

test("HTTP browser/native JWT and API adapters enforce the same role/scope boundary and non-disclosing reads", async () => {
  for (const role of roles) for (const viaKey of [false, true]) {
    if (viaKey && !["owner", "editor", "viewer", "outsider"].includes(role)) continue;
    const ctx = make();
    const headers = { "Content-Type": "application/json", ...(viaKey ? { "X-API-Key": `key-${role}` } : role === "anonymous" ? {} : { Authorization: `Bearer ${sessions[role].authToken}` }) };
    const read = await call("agentReadHttp", "getListWithItems", ctx.action, new Request("https://fixture.invalid/api/v1/lists/items?listId=L", { headers }));
    assert.equal(read.status, role === "anonymous" ? 401 : readers.has(role) ? 200 : 404);
    const write = await call("itemsHttp", "checkItem", ctx.action, new Request("https://fixture.invalid/api/items/check", { method: "POST", headers, body: JSON.stringify({ itemId: "I" }) }));
    assert.equal(write.status, role === "anonymous" ? 401 : editors.has(role) ? 200 : 403);
    const remove = await call("listsHttp", "deleteList", ctx.action, new Request("https://fixture.invalid/api/lists/delete", { method: "POST", headers, body: JSON.stringify({ listId: "L" }) }));
    assert.equal(remove.status, role === "anonymous" ? 401 : role === "owner" ? 200 : 403);
  }
  const ctx = make();
  const key = ctx.rows.agentApiKeys.find(k => k.keyHash === digest("key-editor")); key.scopes = ["items:read"];
  const req = new Request("https://fixture.invalid/api/items/check", { method: "POST", headers: { "X-API-Key": "key-editor", "Content-Type": "application/json" }, body: JSON.stringify({ itemId: "I" }) });
  assert.equal((await call("itemsHttp", "checkItem", ctx.action, req)).status, 403);
});

test("legacy public-link HTTP checks require explicit editor grants, never just login or key scope", async () => {
  for (const role of roles) for (const operation of ["check", "uncheck"]) {
    const ctx = make({ published: true });
    ctx.rows.didLogs = [{ _id: "LOG", path: "owner", userDid: "did:owner", log: "owner-did-log" }];
    const headers = role === "anonymous" ? {} : { Authorization: `Bearer ${sessions[role].authToken}` };
    const response = await call("didResourcesHttp", "didResourceHandler", ctx.action, new Request(
      `https://fixture.invalid/d/owner/resources/list-L/items/I/${operation}`, { method: "POST", headers },
    ));
    assert.equal(response.status, role === "anonymous" ? 401 : editors.has(role) ? 200 : 403);
    if (!editors.has(role)) assert.equal(ctx.rows.items[0].checked, false);
    const publicRead = await call("didResourcesHttp", "didResourceHandler", ctx.action, new Request("https://fixture.invalid/d/owner/resources/list-L"));
    assert.equal(publicRead.status, 200);
    await call("publication", "unpublishList", ctx, { listId: "L", ...credentials("owner") });
    const privateRead = await call("didResourcesHttp", "didResourceHandler", ctx.action, new Request("https://fixture.invalid/d/owner/resources/list-L", { headers }));
    assert.equal(privateRead.status, 404, "public endpoint does not expose private grants");
  }
});

test("attachment URL queries and action checkpoints stop after grant/key revocation; read-only keys report no edit capability", async () => {
  const ctx = make(); ctx.rows.items[0].attachments = [attachment];
  const key = ctx.rows.agentApiKeys.find(k => k._id === "KEY-editor");
  key.scopes = ["lists:read", "items:read"];
  assert.equal((await call("notes", "getNoteBody", ctx, { listId: "N", apiKey: "key-editor" })).canEdit, false);
  assert.equal((await call("items", "getItemForEditor", ctx, { itemId: "I", apiKey: "key-editor" })).canEdit, false);
  await call("attachments", "getAttachmentUrls", ctx, { itemId: "I", ...credentials("viewer") });
  await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: "G-L-viewer", ...credentials("owner") });
  await assert.rejects(() => call("attachments", "getAttachmentUrls", ctx, { itemId: "I", ...credentials("viewer") }), denied);
  assert.deepEqual(bucket.calls, [], "private metadata never issues bearer storage URLs; broker retrieval is covered by revocation.test.mjs");
  key.scopes = ["items:write"];
  const actionCtx = { ...ctx.action, runQuery: async (ref, args) => {
    // Revoke the API key after actor resolution, before resource authorization.
    const result = await ctx.runQuery(ref, args);
    if (result?.viaApiKey) key.revokedAt = Date.now();
    return result;
  } };
  await assert.rejects(() => call("attachments", "generateUploadUrl", actionCtx, { apiKey: "key-editor", itemId: "I", contentType: "image/png", byteLength: 10 }), /Invalid API key/);
  assert.equal(bucket.calls.length, 0);
});

test("anchor ID substitution and malformed anchor associations fail closed", async () => {
  const ctx = make();
  ctx.rows.bitcoinAnchors.push({ _id: "AX", listId: "X", itemId: "IX", txid: "private-tx", status: "pending" });
  for (const role of ["owner", "editor", "viewer"]) {
    await assert.rejects(() => call("bitcoinAnchors", "getAnchor", ctx, { anchorId: "AX", ...credentials(role) }), denied);
    assert.equal(await call("bitcoinAnchors", "getAnchorByTxid", ctx, { txid: "private-tx", ...credentials(role) }), null);
  }
  for (const anchor of [{ _id: "orphan", txid: "orphan" }, { _id: "mixed", listId: "L", itemId: "IX" }]) {
    ctx.rows.bitcoinAnchors.push(anchor);
    await assert.rejects(() => call("bitcoinAnchors", "getAnchor", ctx, { anchorId: anchor._id, ...credentials("owner") }), denied);
  }
});

test("API copy creation requires write scope even for an owner, while a viewer key with that scope can make its own private copy", async () => {
  const ctx = make();
  ctx.rows.agentApiKeys.find(k => k._id === "KEY-owner").scopes = ["items:read"];
  await assert.rejects(() => call("lists", "copyListInternal", ctx, { ...copyArgs, apiKey: "key-owner" }), /Missing scope/);
  const copied = await call("lists", "copyListInternal", ctx, { ...copyArgs, apiKey: "key-viewer" });
  assert.equal(ctx.rows.lists.find(l => l._id === copied.listId).ownerDid, "did:viewer");
  assert.equal(ctx.rows.publications.some(p => p.listId === copied.listId), false);
});

test("anchor verification is read-only for viewers/public readers and read-scoped keys without granting signing or anchor writes", async () => {
  for (const published of [false, true]) for (const role of ["owner", "editor", "viewer", "outsider", "anonymous"]) {
    const ctx = make({ published });
    const before = structuredClone(ctx.rows);
    const verify = () => call("bitcoinAnchors", "verifyAnchorState", ctx.action, { anchorId: "ANCHOR", ...credentials(role) });
    if (role === "anonymous") await assert.rejects(verify, authDenied);
    else if (role === "outsider" && !published) await assert.rejects(verify, denied);
    else {
      const result = await verify();
      assert.equal(typeof result.currentHash, "string");
      assert.equal(result.anchoredHash, "hash");
    }
    assert.deepEqual(ctx.rows, before, "verification cannot mutate signing/anchor or content state");
    if (role !== "anonymous") {
      ctx.rows.agentApiKeys.find(k => k._id === `KEY-${role}`).scopes = ["items:read"];
      const keyVerify = () => call("bitcoinAnchors", "verifyAnchorStateInternal", ctx.action, { anchorId: "ANCHOR", apiKey: `key-${role}` });
      if (role === "outsider" && !published) await assert.rejects(keyVerify, denied);
      else await keyVerify();
      await assert.rejects(() => call("bitcoinAnchors", "createAnchorRecord", ctx, { listId: "L", stateHash: "hash", stateSnapshot: "x", apiKey: `key-${role}` }), /Missing scope/);
      if (role !== "owner") await assert.rejects(() => call("bitcoinAnchors", "createAnchorRecord", ctx, { listId: "L", stateHash: "hash", stateSnapshot: "x", ...credentials(role) }), denied);
    }
  }
});

test("viewer/editor profile statistics include accepted lists/notes, deduplicate bookmarks, and drop revoked/deleting-owner resources", async () => {
  for (const role of ["viewer", "editor"]) for (const suffix of ["", "Internal"]) {
    const ctx = make(); const auth = credentials(role);
    const stats = () => call("users", "getUserStats" + suffix, ctx, auth);
    assert.deepEqual(await stats(), { totalLists: 2, ownedLists: 0, sharedLists: 2, totalItems: 2, completedItems: 0, pendingItems: 2 });
    ctx.rows.bookmarks.push({ _id: "duplicate-list", listId: "L", userDid: `did:${role}` }, { _id: "duplicate-note", listId: "N", userDid: `did:${role}` });
    assert.equal((await stats()).totalLists, 2);
    await call("listGrants", "revokeListGrant", ctx, { listId: "L", grantId: `G-L-${role}`, ...credentials("owner") });
    assert.deepEqual(await stats(), { totalLists: 1, ownedLists: 0, sharedLists: 1, totalItems: 0, completedItems: 0, pendingItems: 0 });
    ctx.rows.users.find(u => u._id === "U-owner").deletionRequestedAt = 5;
    assert.deepEqual(await stats(), { totalLists: 0, ownedLists: 0, sharedLists: 0, totalItems: 0, completedItems: 0, pendingItems: 0 });
  }
  const ctx = make();
  ctx.rows.bookmarks.push({ _id: "owner-bookmark", listId: "L", userDid: "did:owner" });
  ctx.rows.listGrants.push({ _id: "self-redundant", listId: "L", recipientId: "U-owner", role: "viewer", acceptedAt: 1 });
  assert.deepEqual(await call("users", "getUserStats", ctx, credentials("owner")), { totalLists: 2, ownedLists: 2, sharedLists: 0, totalItems: 2, completedItems: 0, pendingItems: 2 });
});

for (const operation of ["updateListGrant", "revokeListGrant"]) for (const suffix of ["", "Internal"]) {
  test(`${operation}${suffix}: access management requires wildcard scope and ownership`, async () => {
    const args = { listId: "L", grantId: "G-L-viewer", ...(operation === "updateListGrant" ? { role: "editor" } : {}) };
    const ctx = make();
    const ownerKey = ctx.rows.agentApiKeys.find(key => key._id === "KEY-owner");
    ownerKey.scopes = ["items:write"];
    const before = structuredClone(ctx.rows);
    await assert.rejects(() => call("listGrants", operation + suffix, ctx, { ...args, apiKey: "key-owner" }), /Missing scope: \*/);
    assert.deepEqual(ctx.rows, before, "item-write authority cannot change access");

    for (const role of ["editor", "viewer", "outsider"]) {
      ctx.rows.agentApiKeys.find(key => key._id === `KEY-${role}`).scopes = ["*"];
      const beforeNonOwner = structuredClone(ctx.rows);
      await assert.rejects(() => call("listGrants", operation + suffix, ctx, { ...args, apiKey: `key-${role}` }), denied);
      assert.deepEqual(ctx.rows, beforeNonOwner, "wildcard scope does not confer ownership");
    }

    ownerKey.scopes = ["*"];
    await call("listGrants", operation + suffix, ctx, { ...args, apiKey: "key-owner" });
    const grant = ctx.rows.listGrants.find(row => row._id === args.grantId);
    if (operation === "updateListGrant") assert.equal(grant.role, "editor");
    else assert.equal(grant, undefined);

    const browser = make();
    await call("listGrants", operation + suffix, browser, { ...args, ...credentials("owner") });
    const browserGrant = browser.rows.listGrants.find(row => row._id === args.grantId);
    if (operation === "updateListGrant") assert.equal(browserGrant.role, "editor");
    else assert.equal(browserGrant, undefined);
  });
}

test("owner roster reads retain lists:read scope after grant-management scope tightening", async () => {
  const ctx = make();
  ctx.rows.agentApiKeys.find(key => key._id === "KEY-owner").scopes = ["lists:read"];
  for (const suffix of ["", "Internal"]) {
    const rows = await call("listGrants", "getListGrants" + suffix, ctx, { listId: "L", apiKey: "key-owner" });
    assert.equal(rows.length, 2);
  }
});
