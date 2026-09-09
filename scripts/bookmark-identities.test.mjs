import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createAuthFixture } from "./helpers/auth-fixture.mjs";

const outfile = "tmp/bookmark-identities/publication.mjs";
await build({
  entryPoints: ["convex/publication.ts"], outfile, bundle: true,
  platform: "node", format: "esm", external: ["convex/*"],
});
const { getUserBookmarkIds, getUserBookmarkIdsInternal } = await import(pathToFileURL(`${process.cwd()}/${outfile}`));
const owner = await createAuthFixture("did:current", { legacyDid: "did:legacy" });
const stranger = await createAuthFixture("did:stranger");

function fixture() {
  const rows = {
    users: [owner.user, stranger.user],
    accessSessions: [owner.accessSession, stranger.accessSession],
    bookmarks: [
      { userDid: "did:current", listId: "current-list" },
      { userDid: "did:current", listId: "shared-list" },
      { userDid: "did:legacy", listId: "legacy-list" },
      { userDid: "did:legacy", listId: "shared-list" },
      { userDid: "did:stranger", listId: "stranger-list" },
    ],
  };
  return { db: { query(table) {
    let matches = rows[table] ?? [];
    const query = {
      withIndex(_name, select) {
        const index = { eq(field, value) { matches = matches.filter(row => row[field] === value); return index; } };
        select(index);
        return query;
      },
      first: async () => matches[0] ?? null,
      collect: async () => matches,
    };
    return query;
  } } };
}

test("bookmark IDs include server-resolved legacy identities and deduplicate lists", async () => {
  for (const operation of [getUserBookmarkIds, getUserBookmarkIdsInternal]) {
    const result = await operation._handler(fixture(), { authToken: owner.authToken });
    assert.deepEqual(result, ["current-list", "shared-list", "legacy-list"]);
  }
});

test("bookmark IDs stay isolated to the authenticated account", async () => {
  assert.deepEqual(await getUserBookmarkIds._handler(fixture(), { authToken: stranger.authToken }), ["stranger-list"]);
  await assert.rejects(() => getUserBookmarkIds._handler(fixture(), {}), /Authentication/);
  await assert.rejects(() => getUserBookmarkIds._handler(fixture(), {
    authToken: stranger.authToken, legacyDid: "did:legacy",
  }), /assertion/);
});
