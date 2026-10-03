/**
 * Pure logic for the Originals Explorer.
 *
 * NOTE: This module must remain Node-safe — no DOM globals (window, localStorage).
 * DOM-coupled helpers live in src/lib/explorerColumns.ts.
 */

export type ExplorerSource = "list" | "site";
export type ExplorerLayer = "did:cel" | "did:webvh" | "did:btco";
export type ExplorerVerification = "verified" | "anchored" | "pending" | "none";

export interface ExplorerRow {
  id: string;
  source: ExplorerSource;
  sourceId: string;
  title: string;
  identifier: string | null;
  layer: ExplorerLayer;
  verification: ExplorerVerification;
  collaborators?: number;
  anchorTxId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExplorerFilters {
  kind: ExplorerSource[];
  layer: ExplorerLayer[];
  verify: ExplorerVerification[];
  q: string;
}

export type ExplorerSortKey = "updated" | "created" | "title";
export type ExplorerSortDir = "asc" | "desc";

export interface ExplorerSort {
  key: ExplorerSortKey;
  dir: ExplorerSortDir;
}

// Raw input shapes (mirroring Convex docs at runtime; keep loose for testability).
interface RawList {
  _id: string;
  _creationTime: number;
  name: string;
  ownerDid: string;
  assetDid: string;
}

interface RawSite {
  _id: string;
  _creationTime: number;
  ownerDid: string;
  primaryHostnameId?: string;
  createdAt: number;
  updatedAt: number;
  did: string;
}

interface RawHostname {
  _id: string;
  siteId: string;
  hostname: string;
  kind: "boop_sub" | "custom";
  cfStatus?: string;
  isPrimary: boolean;
}

interface RawPublication {
  status: "active" | "unpublished";
  webvhDid: string;
  anchorTxId?: string;
  anchorStatus?: string;
}

interface RawAnchor {
  status: "pending" | "inscribed" | "confirmed" | "failed";
  confirmedAt?: number;
  inscribedAt?: number;
  _creationTime?: number;
  txid?: string;
}

interface RawActivity {
  createdAt: number;
}

export interface DeriveInput {
  lists: RawList[];
  sites: RawSite[];
  hostnamesBySite: Map<string, RawHostname[]>;
  publicationsByList: Map<string, RawPublication>;
  anchorsByList: Map<string, RawAnchor[]>;
  activitiesByList: Map<string, RawActivity>;
  assigneesByList: Map<string, number>;
}

export function deriveExplorerRows(input: DeriveInput): ExplorerRow[] {
  const rows: ExplorerRow[] = [];

  for (const list of input.lists) {
    rows.push(deriveListRow(list, input));
  }
  for (const site of input.sites) {
    rows.push(deriveSiteRow(site, input));
  }

  rows.sort(compareExplorerRows({ key: "updated", dir: "desc" }));
  return rows;
}

function deriveListRow(list: RawList, input: DeriveInput): ExplorerRow {
  const pub = input.publicationsByList.get(list._id);
  const isPublished = pub?.status === "active";

  const anchors = input.anchorsByList.get(list._id) ?? [];
  const confirmed = anchors
    .filter((a) => a.status === "confirmed")
    .sort((a, b) => anchorSortKey(b) - anchorSortKey(a))[0];

  let verification: ExplorerVerification = "none";
  if (confirmed) {
    verification = "anchored";
  } else if (anchors.some((a) => a.status === "pending" || a.status === "inscribed")) {
    verification = "pending";
  }

  const activity = input.activitiesByList.get(list._id);
  const updatedAt = Math.max(list._creationTime, activity?.createdAt ?? 0);

  return {
    id: `list:${list._id}`,
    source: "list",
    sourceId: list._id,
    title: list.name,
    identifier: isPublished ? pub.webvhDid : null,
    layer: isPublished ? "did:webvh" : "did:cel",
    verification,
    collaborators: input.assigneesByList.get(list._id),
    anchorTxId: confirmed?.txid,
    createdAt: list._creationTime,
    updatedAt,
  };
}

function anchorSortKey(a: RawAnchor): number {
  return a.confirmedAt ?? a.inscribedAt ?? a._creationTime ?? 0;
}

function deriveSiteRow(site: RawSite, input: DeriveInput): ExplorerRow {
  const allHostnames = input.hostnamesBySite.get(site._id) ?? [];
  const primary =
    site.primaryHostnameId != null
      ? allHostnames.find((h) => h._id === site.primaryHostnameId)
      : undefined;

  const title = primary?.hostname ?? "Untitled site";
  const identifier = primary?.hostname ?? null;

  const primaryIsActiveCustom =
    primary != null && primary.kind === "custom" && primary.cfStatus === "active";
  const anyCustomPending = allHostnames.some(
    (h) => h.kind === "custom" && h.cfStatus !== "active",
  );

  let verification: ExplorerVerification = "none";
  if (primaryIsActiveCustom) {
    verification = "verified";
  } else if (anyCustomPending) {
    verification = "pending";
  }

  return {
    id: `site:${site._id}`,
    source: "site",
    sourceId: site._id,
    title,
    identifier,
    layer: "did:webvh",
    verification,
    createdAt: site._creationTime,
    updatedAt: site.updatedAt,
  };
}

export function applyExplorerFilters(rows: ExplorerRow[], f: ExplorerFilters): ExplorerRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (f.kind.length > 0 && !f.kind.includes(row.source)) return false;
    if (f.layer.length > 0 && !f.layer.includes(row.layer)) return false;
    if (f.verify.length > 0 && !f.verify.includes(row.verification)) return false;
    if (q.length > 0) {
      const haystack = `${row.title} ${row.identifier ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function compareExplorerRows(sort: ExplorerSort) {
  return (a: ExplorerRow, b: ExplorerRow): number => {
    let primary = 0;
    if (sort.key === "updated") primary = a.updatedAt - b.updatedAt;
    else if (sort.key === "created") primary = a.createdAt - b.createdAt;
    else primary = a.title.localeCompare(b.title);

    if (sort.dir === "desc") primary = -primary;
    if (primary !== 0) return primary;

    // Tiebreaker: id ascending (always)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

// URL params ---------------------------------------------------------------

export function encodeFiltersToParams(f: ExplorerFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.kind.length > 0) params.set("kind", f.kind.join(","));
  if (f.layer.length > 0) params.set("layer", f.layer.join(","));
  if (f.verify.length > 0) params.set("verify", f.verify.join(","));
  if (f.q.length > 0) params.set("q", f.q);
  return params;
}

const VALID_KINDS = new Set<ExplorerSource>(["list", "site"]);
const VALID_LAYERS = new Set<ExplorerLayer>(["did:cel", "did:webvh", "did:btco"]);
const VALID_VERIFY = new Set<ExplorerVerification>(["verified", "anchored", "pending", "none"]);

export function decodeFiltersFromParams(p: URLSearchParams): ExplorerFilters {
  const split = (raw: string | null) => (raw ? raw.split(",") : []);
  return {
    kind: split(p.get("kind")).filter((v): v is ExplorerSource => VALID_KINDS.has(v as ExplorerSource)),
    layer: split(p.get("layer")).filter((v): v is ExplorerLayer => VALID_LAYERS.has(v as ExplorerLayer)),
    verify: split(p.get("verify")).filter((v): v is ExplorerVerification => VALID_VERIFY.has(v as ExplorerVerification)),
    q: p.get("q") ?? "",
  };
}
