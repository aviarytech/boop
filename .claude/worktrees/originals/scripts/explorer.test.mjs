import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/explorer-test";

async function loadExplorer() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/explorer.ts"],
    outfile: `${outdir}/explorer.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/explorer.mjs`).href}?t=${Date.now()}`
  );
}

const explorer = await loadExplorer();

// Helpers to build raw input shapes ----------------------------------------

function makeList(over = {}) {
  return {
    _id: "list1",
    _creationTime: 1000,
    assetDid: "did:cel:list1",
    name: "Untitled list",
    ownerDid: "did:webvh:owner",
    ...over,
  };
}

function makeSite(over = {}) {
  return {
    _id: "site1",
    _creationTime: 500,
    ownerDid: "did:webvh:owner",
    scid: "scid1",
    did: "did:webvh:scid1.boop.ad",
    primaryHostnameId: "host1",
    fileId: "file1",
    createdAt: 500,
    updatedAt: 500,
    ...over,
  };
}

function makeHostname(over = {}) {
  return {
    _id: "host1",
    siteId: "site1",
    hostname: "brisk-paper-07.boop.ad",
    kind: "boop_sub",
    status: "active",
    isPrimary: true,
    createdAt: 500,
    updatedAt: 500,
    ...over,
  };
}

// deriveExplorerRow --------------------------------------------------------

test("empty input → empty rows", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows.length, 0);
});

test("one list + one site → 2 rows ordered by updatedAt desc", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L", _creationTime: 100, name: "Older list" })],
    sites: [makeSite({ _id: "S", _creationTime: 50, updatedAt: 999 })],
    hostnamesBySite: new Map([["S", [makeHostname({ siteId: "S" })]]]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "site");   // updatedAt 999
  assert.equal(rows[1].source, "list");   // _creationTime 100
});

test("updatedAt: list with no activities → list._creationTime", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L", _creationTime: 7777 })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].updatedAt, 7777);
});

test("updatedAt: list with newer activity wins", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L", _creationTime: 100 })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map([["L", { createdAt: 9999 }]]),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].updatedAt, 9999);
});

test("site missing primary hostname → title falls back to 'Untitled site'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: undefined })],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].title, "Untitled site");
  assert.equal(rows[0].identifier, null);
});

// Layer / identifier derivation --------------------------------------------

test("published list (active publication) → did:webvh + identifier", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map([
      ["L", { status: "active", webvhDid: "did:webvh:list-L" }],
    ]),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].layer, "did:webvh");
  assert.equal(rows[0].identifier, "did:webvh:list-L");
});

test("list with no publication → did:cel + null identifier", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].layer, "did:cel");
  assert.equal(rows[0].identifier, null);
});

test("list with unpublished publication → treated as did:cel", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map([
      ["L", { status: "unpublished", webvhDid: "did:webvh:list-L" }],
    ]),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].layer, "did:cel");
  assert.equal(rows[0].identifier, null);
});

// Verification derivation --------------------------------------------------

test("confirmed bitcoin anchor → verification 'anchored'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map([
      ["L", [{ status: "confirmed", confirmedAt: 100, txid: "tx1" }]],
    ]),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "anchored");
  assert.equal(rows[0].anchorTxId, "tx1");
});

test("multiple confirmed anchors → most recent confirmedAt wins", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map([
      ["L", [
        { status: "confirmed", confirmedAt: 100, txid: "older" },
        { status: "confirmed", confirmedAt: 500, txid: "newer" },
      ]],
    ]),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].anchorTxId, "newer");
});

test("pending bitcoin anchor → verification 'pending'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map([["L", [{ status: "pending" }]]]),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "pending");
});

test("publications.anchorTxId is ignored (only bitcoinAnchors counts)", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L" })],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map([
      ["L", { status: "active", webvhDid: "did:webvh:L", anchorTxId: "ghost", anchorStatus: "verified" }],
    ]),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "none");
  assert.equal(rows[0].anchorTxId, undefined);
});

test("site primary custom + active → 'verified'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: "host1" })],
    hostnamesBySite: new Map([
      ["S", [makeHostname({ _id: "host1", kind: "custom", cfStatus: "active", isPrimary: true })]],
    ]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "verified");
});

test("site primary boop_sub + non-primary custom pending → 'pending'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: "host1" })],
    hostnamesBySite: new Map([
      ["S", [
        makeHostname({ _id: "host1", kind: "boop_sub", cfStatus: undefined, isPrimary: true }),
        makeHostname({ _id: "host2", kind: "custom", cfStatus: "pending_validation", isPrimary: false }),
      ]],
    ]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "pending");
});

test("site primary custom but cfStatus !== active → 'pending'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: "host1" })],
    hostnamesBySite: new Map([
      ["S", [makeHostname({ _id: "host1", kind: "custom", cfStatus: "pending_issuance", isPrimary: true })]],
    ]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "pending");
});

test("site only boop_sub primary, no custom rows → 'none'", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S" })],
    hostnamesBySite: new Map([["S", [makeHostname()]]]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "none");
});

test("site with primaryHostnameId === null and no custom rows → 'none' (no crash)", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: undefined })],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "none");
});

test("verification precedence: anchored > verified > pending > none", () => {
  // Construct a site with both 'verified' and 'pending' signals to exercise the precedence path.
  const rows = explorer.deriveExplorerRows({
    lists: [],
    sites: [makeSite({ _id: "S", primaryHostnameId: "host1" })],
    hostnamesBySite: new Map([
      ["S", [
        makeHostname({ _id: "host1", kind: "custom", cfStatus: "active", isPrimary: true }),
        makeHostname({ _id: "host2", kind: "custom", cfStatus: "pending_validation", isPrimary: false }),
      ]],
    ]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  assert.equal(rows[0].verification, "verified");
});

// applyExplorerFilters -----------------------------------------------------

function rowsForFilterTests() {
  return explorer.deriveExplorerRows({
    lists: [makeList({ _id: "L", name: "Groceries" })],
    sites: [makeSite({ _id: "S", primaryHostnameId: "host1" })],
    hostnamesBySite: new Map([
      ["S", [makeHostname({ _id: "host1", hostname: "essay.brian.dev", kind: "custom", cfStatus: "active", isPrimary: true })]],
    ]),
    publicationsByList: new Map(),
    anchorsByList: new Map(),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
}

test("filter by kind list-only → excludes sites", () => {
  const filtered = explorer.applyExplorerFilters(rowsForFilterTests(), {
    kind: ["list"], layer: [], verify: [], q: "",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source, "list");
});

test("filter by layer did:webvh → excludes did:cel", () => {
  const filtered = explorer.applyExplorerFilters(rowsForFilterTests(), {
    kind: [], layer: ["did:webvh"], verify: [], q: "",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source, "site");
});

test("filter by verification 'anchored' → only anchored rows pass", () => {
  const rows = explorer.deriveExplorerRows({
    lists: [
      makeList({ _id: "L1", name: "Anchored list" }),
      makeList({ _id: "L2", name: "Plain list" }),
    ],
    sites: [],
    hostnamesBySite: new Map(),
    publicationsByList: new Map(),
    anchorsByList: new Map([["L1", [{ status: "confirmed", confirmedAt: 1, txid: "tx" }]]]),
    activitiesByList: new Map(),
    assigneesByList: new Map(),
  });
  const filtered = explorer.applyExplorerFilters(rows, {
    kind: [], layer: [], verify: ["anchored"], q: "",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "list:L1");
});

test("empty multi-select group → no filter applied (all pass)", () => {
  const filtered = explorer.applyExplorerFilters(rowsForFilterTests(), {
    kind: [], layer: [], verify: [], q: "",
  });
  assert.equal(filtered.length, 2);
});

test("case-insensitive title search; matches identifier too", () => {
  const rows = rowsForFilterTests();
  const byTitle = explorer.applyExplorerFilters(rows, {
    kind: [], layer: [], verify: [], q: "GROC",
  });
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].source, "list");

  const byIdentifier = explorer.applyExplorerFilters(rows, {
    kind: [], layer: [], verify: [], q: "essay",
  });
  assert.equal(byIdentifier.length, 1);
  assert.equal(byIdentifier[0].source, "site");
});

// compareExplorerRows ------------------------------------------------------

test("sort: updatedAt desc primary, id asc tiebreaker", () => {
  const a = { id: "list:b", updatedAt: 100, createdAt: 1, title: "x" };
  const b = { id: "list:a", updatedAt: 100, createdAt: 1, title: "x" };
  const sorted = [a, b].sort(explorer.compareExplorerRows({ key: "updated", dir: "desc" }));
  assert.equal(sorted[0].id, "list:a"); // tiebreaker: id ascending
  assert.equal(sorted[1].id, "list:b");
});

test("sort: title A-Z stable with id tiebreaker", () => {
  const a = { id: "list:b", updatedAt: 1, createdAt: 1, title: "Apple" };
  const b = { id: "list:a", updatedAt: 1, createdAt: 1, title: "Apple" };
  const sorted = [a, b].sort(explorer.compareExplorerRows({ key: "title", dir: "asc" }));
  assert.equal(sorted[0].id, "list:a");
});

// URL param encode/decode --------------------------------------------------

test("encodeFiltersToParams: csv values for multi-select", () => {
  const params = explorer.encodeFiltersToParams({
    kind: ["list", "site"],
    layer: ["did:webvh"],
    verify: [],
    q: "foo",
  });
  assert.equal(params.get("kind"), "list,site");
  assert.equal(params.get("layer"), "did:webvh");
  assert.equal(params.get("verify"), null); // empty arrays are omitted
  assert.equal(params.get("q"), "foo");
});

test("decodeFiltersFromParams: csv → arrays; empty string q omitted", () => {
  const decoded = explorer.decodeFiltersFromParams(
    new URLSearchParams("kind=list,site&q=foo")
  );
  assert.deepEqual(decoded.kind, ["list", "site"]);
  assert.deepEqual(decoded.layer, []);
  assert.deepEqual(decoded.verify, []);
  assert.equal(decoded.q, "foo");
});

test("URL round-trip preserves commas in q via encoding", () => {
  const original = { kind: [], layer: [], verify: [], q: "hello, world" };
  const params = explorer.encodeFiltersToParams(original);
  const url = `?${params.toString()}`;
  // Build new URLSearchParams from the URL string
  const parsed = new URLSearchParams(url.slice(1));
  const decoded = explorer.decodeFiltersFromParams(parsed);
  assert.equal(decoded.q, "hello, world");
});

await rm(outdir, { recursive: true, force: true });
