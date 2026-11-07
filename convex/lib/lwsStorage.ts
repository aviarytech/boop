/**
 * LWS storage resources (docs/lws-agent-auth.md "Storage"): which resource a
 * path names, the representations boop serves, validators and preconditions,
 * byte ranges, JSON Patch (RFC 6902) and JSON Merge Patch (RFC 7396), and the
 * item fields an agent may write. Pure apart from Web Crypto, so tests import
 * it directly; convex/lwsStorage.ts and convex/lwsStorageHttp.ts use it.
 */
import { ConvexError } from "convex/values";
import { LWS_CONTEXT } from "./lwsAccess";
import { LWS_STORAGE_REL } from "./lwsUrls";
import { MAX_NOTE_LENGTH } from "./noteBody";

export const LWS_NS = "https://www.w3.org/ns/lws#";
export const CID_CONTEXT = "https://www.w3.org/ns/cid/v1";
export const LWS_CID = "application/lws+cid";
export const LINKSET_JSON = "application/linkset+json";
export const JSON_MEDIA = "application/json";
export const MERGE_PATCH = "application/merge-patch+json";
export const JSON_PATCH = "application/json-patch+json";
/** A resource's linkset is the resource's URI with this appended. */
export const LINKSET_SUFFIX = ".meta";
/** Largest request body accepted: an item's description may be 50,000 characters. */
export const MAX_STORAGE_BODY_BYTES = 256 * 1024;

const ID_SEGMENT = "([A-Za-z0-9]{1,64})";

export type ResourceTarget =
  | { kind: "root" }
  | { kind: "list"; listId: string }
  | { kind: "item"; listId: string; itemId: string };
export type StorageTarget =
  | { kind: "description" }
  | (ResourceTarget & { linkset: boolean });

/** What a subpath of `B/lws/{u}` (lwsUrls.ts parseStoragePath) names, or null if nothing. */
export function parseTarget(subpath: string): StorageTarget | null {
  if (subpath === "") return { kind: "description" };
  if (subpath === "/") return { kind: "root", linkset: false };
  if (subpath === `/${LINKSET_SUFFIX}`) return { kind: "root", linkset: true };
  let match = new RegExp(`^/${ID_SEGMENT}/(\\${LINKSET_SUFFIX})?$`).exec(subpath);
  if (match) return { kind: "list", listId: match[1], linkset: match[2] !== undefined };
  match = new RegExp(`^/${ID_SEGMENT}/${ID_SEGMENT}(\\${LINKSET_SUFFIX})?$`).exec(subpath);
  if (match) return { kind: "item", listId: match[1], itemId: match[2], linkset: match[3] !== undefined };
  return null;
}

/** The methods a target supports; the same for every resource of its kind. */
export function allowedMethods(target: StorageTarget): string[] {
  if (target.kind === "description") return ["GET", "HEAD", "OPTIONS"];
  if (target.linkset) return ["GET", "HEAD", "PATCH", "OPTIONS"];
  if (target.kind === "root") return ["GET", "HEAD", "OPTIONS"];
  if (target.kind === "list") return ["GET", "HEAD", "POST", "OPTIONS"];
  return ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];
}

// ---------------------------------------------------------------------------
// URIs and links
// ---------------------------------------------------------------------------

export const rootUri = (storage: string) => `${storage}/`;
export const listUri = (storage: string, listId: string) => `${storage}/${listId}/`;
export const itemUri = (storage: string, listId: string, itemId: string) => `${storage}/${listId}/${itemId}`;
export const linksetUri = (resource: string) => `${resource}${LINKSET_SUFFIX}`;

export function resourceUri(storage: string, target: ResourceTarget): string {
  return target.kind === "root" ? rootUri(storage)
    : target.kind === "list" ? listUri(storage, target.listId)
      : itemUri(storage, target.listId, target.itemId);
}

/** The parent container: none for the root. */
export function upUri(storage: string, target: ResourceTarget): string | null {
  return target.kind === "root" ? null
    : target.kind === "list" ? rootUri(storage)
      : listUri(storage, target.listId);
}

export const typeUri = (target: ResourceTarget) => `${LWS_NS}${target.kind === "item" ? "DataResource" : "Container"}`;

/** The server-managed links of a resource, as `Link` header values (read-resource.md, metadata.md). */
export function resourceLinks(storage: string, target: ResourceTarget): string[] {
  const self = resourceUri(storage, target);
  const up = upUri(storage, target);
  return [
    `<${linksetUri(self)}>; rel="linkset"; type="${LINKSET_JSON}"`,
    ...(up ? [`<${up}>; rel="up"`] : []),
    `<${typeUri(target)}>; rel="type"`,
    `<${storage}>; rel="${LWS_STORAGE_REL}"`,
  ];
}

/** The linkset resource (RFC 9264) for a resource: the same server-managed links. */
export function linksetDocument(storage: string, target: ResourceTarget) {
  const up = upUri(storage, target);
  return {
    linkset: [{
      anchor: resourceUri(storage, target),
      ...(up ? { up: [{ href: up }] } : {}),
      type: [{ href: typeUri(target) }],
      [LWS_STORAGE_REL]: [{ href: storage }],
    }],
  };
}

/**
 * The storage description (Discovery.html), with the AccessRequestService
 * phase 1 serves. It doesn't claim `conformsTo` the LWS AccessProfile: that
 * profile requires constraints (and targets below the root) that boop
 * refuses, so a client relying on the claim would be misled.
 */
export function storageDescription(storage: string, accessRequests: string) {
  return {
    "@context": [CID_CONTEXT, LWS_CONTEXT],
    id: storage,
    type: "Storage",
    service: [
      { type: "StorageRoot", serviceEndpoint: rootUri(storage) },
      { type: "AccessRequestService", serviceEndpoint: accessRequests },
    ],
  };
}

// ---------------------------------------------------------------------------
// Representations
// ---------------------------------------------------------------------------

export type Priority = "high" | "medium" | "low";
export type Recurrence = { frequency: "daily" | "weekly" | "monthly"; interval?: number; nextDue?: number; endDate?: number };
/** The fields of an items row a representation reads. */
export type ItemRow = {
  _id: string; _creationTime: number; listId: string; name: string; checked: boolean; checkedAt?: number;
  description?: string; dueDate?: number; url?: string; priority?: Priority; recurrence?: Recurrence;
  parentId?: string; createdAt: number; updatedAt?: number; order?: number;
};
export type ListRow = { _id: string; _creationTime: number; name: string; createdAt: number };

/** An ISO 8601 time for a stored millisecond value; null if there is none or it is out of range. */
export function isoTime(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  return new Date(ms).toISOString();
}

export function recurrenceView(recurrence: Recurrence | undefined) {
  if (!recurrence) return null;
  return {
    frequency: recurrence.frequency,
    ...(recurrence.interval !== undefined ? { interval: recurrence.interval } : {}),
    ...(recurrence.endDate !== undefined ? { endDate: isoTime(recurrence.endDate) } : {}),
  };
}

/** An item as `application/json`. Every member is always present; absent values are null. */
export function itemDocument(storage: string, item: ItemRow) {
  return {
    id: itemUri(storage, item.listId, item._id),
    name: item.name,
    checked: item.checked,
    checkedAt: item.checked ? isoTime(item.checkedAt) : null,
    // The app stores a cleared description as "", so "" and absent read the same.
    description: item.description || null,
    dueDate: isoTime(item.dueDate),
    url: item.url || null,
    priority: item.priority ?? null,
    recurrence: recurrenceView(item.recurrence),
    parent: item.parentId ? itemUri(storage, item.listId, item.parentId) : null,
    createdAt: isoTime(item.createdAt) ?? isoTime(item._creationTime),
    updatedAt: isoTime(item.updatedAt),
  };
}
export type ItemDocument = ReturnType<typeof itemDocument>;

/** When an item's representation last changed. Every write to a represented field sets updatedAt. */
export const itemModified = (item: ItemRow) => item.updatedAt ?? item.createdAt;

export const byPosition = (a: ItemRow, b: ItemRow) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * Items per page of a list container (lws-media-type.md "Pagination"). A list
 * with more is paginated: each page lists this many members in list order,
 * and `totalItems` counts them all.
 */
export const LIST_PAGE_SIZE = 500;

export const listPageCount = (total: number) => Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));

/** A page of a list container: the container itself for the first, `?page=n` after it. Opaque to clients. */
export const listPageUri = (storage: string, listId: string, page: number) =>
  page <= 1 ? listUri(storage, listId) : `${listUri(storage, listId)}?page=${page}`;

/** `?page=n` → n; 1 when absent; null when it isn't a page number. */
export function parsePageParam(value: string | null): number | null {
  if (value === null) return 1;
  return /^[1-9][0-9]{0,6}$/.test(value) ? Number(value) : null;
}

/** The pagination `Link` values of a page (rel first, last, prev, next); none for a list that fits on one. */
export function paginationLinks(storage: string, listId: string, total: number, page: number): string[] {
  const pages = listPageCount(total);
  if (pages === 1) return [];
  const at = (n: number) => listPageUri(storage, listId, n);
  return [
    `<${at(1)}>; rel="first"`,
    `<${at(pages)}>; rel="last"`,
    ...(page > 1 ? [`<${at(page - 1)}>; rel="prev"`] : []),
    ...(page < pages ? [`<${at(page + 1)}>; rel="next"`] : []),
  ];
}

/**
 * A list as a container of its items (container-representation.md), with its
 * title: page `page` of its members in list order, and the total count.
 */
export function listContainerDocument(storage: string, list: ListRow, items: ItemRow[], page = 1) {
  const sorted = [...items].sort(byPosition);
  const members = sorted.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE).map(item => ({
    type: "DataResource",
    id: itemUri(storage, item.listId, item._id),
    format: JSON_MEDIA,
    size: utf8Length(JSON.stringify(itemDocument(storage, item))),
    modified: isoTime(itemModified(item)),
  }));
  return { "@context": LWS_CONTEXT, id: listUri(storage, list._id), type: "Container", title: list.name, totalItems: sorted.length, items: members };
}

/** When a list container last changed, as far as boop records it: deletions leave no time. */
export function listModified(list: ListRow, items: ItemRow[]): number {
  return Math.max(list.createdAt, ...items.map(itemModified));
}

/**
 * A list's `modified` in the root container, from its latest item by the
 * `by_list_updated` index (one read per list, not every item): the list's
 * `createdAt` when it has none.
 */
export const listModifiedFromLatest = (list: ListRow, latest: ItemRow | null) =>
  Math.max(list.createdAt, latest ? itemModified(latest) : list.createdAt);

/** The storage root: the user's own lists, as containers. */
export function rootContainerDocument(storage: string, lists: Array<{ list: ListRow; modified: number }>) {
  const members = [...lists].sort((a, b) => a.list.createdAt - b.list.createdAt).map(({ list, modified }) => ({
    type: "Container",
    id: listUri(storage, list._id),
    format: "application/lws+json",
    title: list.name,
    modified: isoTime(modified),
  }));
  return { "@context": LWS_CONTEXT, id: rootUri(storage), type: "Container", totalItems: members.length, items: members };
}

/** A strong validator for a representation: a digest of its exact bytes. */
export async function entityTag(body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("")}"`;
}

// ---------------------------------------------------------------------------
// Preconditions (RFC 9110 13.2.2) and ranges (RFC 9110 14)
// ---------------------------------------------------------------------------

export type Preconditions = { ifMatch?: string; ifNoneMatch?: string; ifModifiedSince?: string; ifUnmodifiedSince?: string };
export type Validators = { etag: string; lastModified: number; lastModifiedExact: boolean };

export function hasPreconditions(p: Preconditions): boolean {
  return p.ifMatch !== undefined || p.ifNoneMatch !== undefined || p.ifUnmodifiedSince !== undefined;
}

/** `*`, or the entity-tags of a list; unparsable members are dropped (they match nothing). */
function entityTags(header: string): "*" | Array<{ weak: boolean; tag: string }> {
  if (header.trim() === "*") return "*";
  const tags = [];
  for (const match of header.matchAll(/(W\/)?("[\x21\x23-\x7e\x80-\xff]*")/g)) tags.push({ weak: match[1] !== undefined, tag: match[2] });
  return tags;
}

/** A valid HTTP-date, in seconds; null otherwise (RFC 9110: an invalid date is ignored). */
function httpDateSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * RFC 9110 13.2.2, for a resource that exists. `read` is GET/HEAD: a matching
 * If-None-Match, or an unchanged If-Modified-Since when the modification time
 * is exact, is "not-modified"; for any other method a match is "failed". Our
 * ETags are always strong.
 */
export function evaluatePreconditions(p: Preconditions, current: Validators, read: boolean): "proceed" | "not-modified" | "failed" {
  const seconds = Math.floor(current.lastModified / 1000);
  if (p.ifMatch !== undefined) {
    const tags = entityTags(p.ifMatch);
    if (tags !== "*" && !tags.some(t => !t.weak && t.tag === current.etag)) return "failed";
  } else {
    const since = httpDateSeconds(p.ifUnmodifiedSince);
    if (since !== null && current.lastModifiedExact && seconds > since) return "failed";
  }
  if (p.ifNoneMatch !== undefined) {
    const tags = entityTags(p.ifNoneMatch);
    if (tags === "*" || tags.some(t => t.tag === current.etag)) return read ? "not-modified" : "failed";
  } else if (read) {
    const since = httpDateSeconds(p.ifModifiedSince);
    if (since !== null && current.lastModifiedExact && seconds <= since) return "not-modified";
  }
  return "proceed";
}

/**
 * A single byte range of a `length`-byte representation (RFC 9110 14.1.2), or
 * "unsatisfiable", or null to send the whole representation: no or an invalid
 * Range, several ranges, or an If-Range that doesn't hold.
 */
export function selectRange(range: string | undefined, ifRange: string | undefined, current: Validators, length: number):
  { start: number; end: number } | "unsatisfiable" | null {
  if (range === undefined) return null;
  if (ifRange !== undefined) {
    const value = ifRange.trim();
    if (value.startsWith('"') || value.startsWith("W/")) {
      if (value !== current.etag) return null;
    } else if (!current.lastModifiedExact || httpDateSeconds(value) !== Math.floor(current.lastModified / 1000)) return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0 || length === 0) return "unsatisfiable";
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(match[1]);
  if (match[2] !== "" && Number(match[2]) < start) return null;
  if (start >= length) return "unsatisfiable";
  return { start, end: match[2] === "" ? length - 1 : Math.min(Number(match[2]), length - 1) };
}

// ---------------------------------------------------------------------------
// Failures: thrown from inside a Convex function so the transaction rolls back,
// and carried across the function boundary as ConvexError data.
// ---------------------------------------------------------------------------

export type LwsFailureData = {
  kind: "lws"; status: number; title: string; detail?: string;
  /** Add the Bearer challenge with this error (401, or 403 for scope). */
  challenge?: "invalid_token" | "insufficient_scope";
};

export function lwsFailure(status: number, title: string, detail?: string, challenge?: LwsFailureData["challenge"]): ConvexError<LwsFailureData> {
  return new ConvexError<LwsFailureData>({ kind: "lws", status, title, ...(detail ? { detail } : {}), ...(challenge ? { challenge } : {}) });
}

export function lwsFailureData(error: unknown): LwsFailureData | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data as Partial<LwsFailureData> | null;
  if (!data || typeof data !== "object" || data.kind !== "lws" || typeof data.status !== "number" || typeof data.title !== "string") return null;
  return data as LwsFailureData;
}

export const notFound = () => lwsFailure(404, "Not found");

// ---------------------------------------------------------------------------
// JSON documents and patches
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 409; detail: string };
const fail = (status: 400 | 409, detail: string) => ({ ok: false as const, status, detail });

const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Own-property assignment, so a key such as `__proto__` stays a key and is then refused as unknown. */
const setKey = (object: Record<string, Json>, key: string, value: Json) =>
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => jsonEqual(value, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => has(b, key) && jsonEqual(a[key], b[key]));
}

/** RFC 7396. */
export function mergePatch(target: unknown, patch: unknown): Json {
  if (!isObject(patch)) return clone(patch as Json);
  const result: Record<string, Json> = isObject(target) ? clone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else setKey(result, key, mergePatch(has(result, key) ? result[key] : undefined, value));
  }
  return result;
}

function pointer(path: unknown): string[] | null {
  if (typeof path !== "string" || (path !== "" && !path.startsWith("/"))) return null;
  if (/~[^01]|~$/.test(path)) return null;
  return path === "" ? [] : path.slice(1).split("/").map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function resolve(document: Json, tokens: string[]): { found: true; value: Json } | { found: false } {
  let node: Json = document;
  for (const token of tokens) {
    if (Array.isArray(node) && ARRAY_INDEX.test(token) && Number(token) < node.length) node = node[Number(token)];
    else if (isObject(node) && has(node, token)) node = node[token];
    else return { found: false };
  }
  return { found: true, value: node };
}

/** RFC 6902, all or nothing. A malformed patch is 400; one that doesn't apply to this document is 409. */
export function applyJsonPatch(document: unknown, patch: unknown): Result<Json> {
  if (!Array.isArray(patch)) return fail(400, "A JSON Patch is an array of operations");
  let doc = clone(document as Json);
  for (const [index, operation] of patch.entries()) {
    const where = `operation ${index}`;
    if (!isObject(operation) || typeof operation.op !== "string") return fail(400, `${where} has no op`);
    const path = pointer(operation.path);
    if (!path) return fail(400, `${where} has no valid path`);
    const needsValue = ["add", "replace", "test"].includes(operation.op);
    if (needsValue && !has(operation, "value")) return fail(400, `${where} has no value`);
    const from = ["move", "copy"].includes(operation.op) ? pointer(operation.from) : [];
    if (!from) return fail(400, `${where} has no valid from`);

    const parentOf = (tokens: string[]) => resolve(doc, tokens.slice(0, -1));
    const add = (tokens: string[], value: Json): string | null => {
      if (tokens.length === 0) { doc = value; return null; }
      const parent = parentOf(tokens);
      const key = tokens[tokens.length - 1];
      if (!parent.found) return `${where}: the parent of its path does not exist`;
      if (Array.isArray(parent.value)) {
        if (key === "-") { parent.value.push(value); return null; }
        if (!ARRAY_INDEX.test(key) || Number(key) > parent.value.length) return `${where}: the array index is out of bounds`;
        parent.value.splice(Number(key), 0, value);
        return null;
      }
      if (!isObject(parent.value)) return `${where}: the parent of its path is not a container`;
      setKey(parent.value, key, value);
      return null;
    };
    const remove = (tokens: string[]): string | null => {
      if (tokens.length === 0) return `${where}: the document itself can't be removed`;
      if (!resolve(doc, tokens).found) return `${where}: its path does not exist`;
      const parent = (parentOf(tokens) as { value: Json[] | Record<string, Json> }).value;
      const key = tokens[tokens.length - 1];
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      return null;
    };

    let problem: string | null = null;
    switch (operation.op) {
      case "add": problem = add(path, clone(operation.value)); break;
      case "remove": problem = remove(path); break;
      case "replace":
        if (!resolve(doc, path).found) problem = `${where}: its path does not exist`;
        else problem = path.length === 0 ? (doc = clone(operation.value), null) : (remove(path) ?? add(path, clone(operation.value)));
        break;
      case "move": {
        const source = resolve(doc, from);
        if (!source.found) { problem = `${where}: from does not exist`; break; }
        if (path.length > from.length && from.every((token, i) => path[i] === token)) { problem = `${where}: can't move a value into itself`; break; }
        problem = remove(from) ?? add(path, source.value);
        break;
      }
      case "copy": {
        const source = resolve(doc, from);
        problem = source.found ? add(path, clone(source.value)) : `${where}: from does not exist`;
        break;
      }
      case "test": {
        const target = resolve(doc, path);
        if (!target.found || !jsonEqual(target.value, operation.value)) problem = `${where}: test failed`;
        break;
      }
      default: return fail(400, `${where} has an unknown op`);
    }
    if (problem) return fail(409, problem);
  }
  return { ok: true, value: doc };
}

// ---------------------------------------------------------------------------
// Item input
// ---------------------------------------------------------------------------

export const MAX_ITEM_NAME = 500;
export const MAX_ITEM_URL = 2000;
/** addItem's own cap; longer descriptions are written by updateItem in the same transaction. */
export const MAX_CREATE_DESCRIPTION = 2000;
const WRITABLE = ["name", "checked", "description", "dueDate", "url", "priority", "recurrence", "parent"] as const;
const READ_ONLY = ["id", "checkedAt", "createdAt", "updatedAt"] as const;
const PRIORITIES = ["high", "medium", "low"];
const FREQUENCIES = ["daily", "weekly", "monthly"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** What an agent asks an item to be, in stored units. */
export type ItemInput = {
  name: string;
  checked: boolean;
  description?: string;
  dueDate?: number;
  url?: string;
  priority?: Priority;
  recurrence?: Recurrence;
  /** The parent's item id (create only; a parent never changes). */
  parentId?: string;
};

function time(value: unknown, member: string): Result<number | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string" || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value))) return fail(400, `${member} must be an ISO 8601 date or date-time`);
  return { ok: true, value: Date.parse(value) };
}

function recurrenceInput(value: unknown): Result<Recurrence | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!isObject(value)) return fail(400, "recurrence must be an object or null");
  const unknown = Object.keys(value).filter(key => !["frequency", "interval", "endDate"].includes(key));
  if (unknown.length) return fail(400, `recurrence has unknown members: ${unknown.join(", ")}`);
  if (typeof value.frequency !== "string" || !FREQUENCIES.includes(value.frequency)) return fail(400, "recurrence.frequency must be daily, weekly or monthly");
  const interval = value.interval ?? undefined;
  if (interval !== undefined && (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 1000)) {
    return fail(400, "recurrence.interval must be an integer from 1 to 1000");
  }
  const endDate = time(value.endDate, "recurrence.endDate");
  if (!endDate.ok) return endDate;
  return {
    ok: true,
    value: {
      frequency: value.frequency as Recurrence["frequency"],
      ...(interval !== undefined ? { interval } : {}),
      ...(endDate.value !== undefined ? { endDate: endDate.value } : {}),
    },
  };
}

/**
 * Validate an item document. `create` (POST): no read-only members, and
 * `parent` may name an item of `list`. `current` (PUT, or the result of a
 * PATCH): read-only members and `parent` may be left out, or must be what they
 * are now. Unknown members are refused (400): boop can't store them.
 */
export function parseItemInput(body: unknown, list: string, current?: ItemDocument): Result<ItemInput> {
  if (!isObject(body)) return fail(400, "An item is a JSON object");
  const unknown = Object.keys(body).filter(key => !(WRITABLE as readonly string[]).includes(key) && !(READ_ONLY as readonly string[]).includes(key));
  if (unknown.length) return fail(400, `Unknown members: ${unknown.join(", ")}`);
  for (const key of READ_ONLY) {
    if (!has(body, key)) continue;
    if (!current) return fail(400, `${key} is assigned by the server`);
    if (!jsonEqual(body[key], current[key])) return fail(409, `${key} is read-only`);
  }

  if (typeof body.name !== "string" || body.name.trim() === "") return fail(400, "name is required");
  if (body.name.length > MAX_ITEM_NAME) return fail(400, `name is longer than ${MAX_ITEM_NAME} characters`);
  const checked = body.checked ?? false;
  if (typeof checked !== "boolean") return fail(400, "checked must be true or false");
  const description = body.description ?? undefined;
  if (description !== undefined && typeof description !== "string") return fail(400, "description must be a string or null");
  if (description !== undefined && description.length > MAX_NOTE_LENGTH) return fail(400, `description is longer than ${MAX_NOTE_LENGTH} characters`);
  const url = body.url ?? undefined;
  if (url !== undefined && typeof url !== "string") return fail(400, "url must be a string or null");
  if (url !== undefined && url.length > MAX_ITEM_URL) return fail(400, `url is longer than ${MAX_ITEM_URL} characters`);
  const priority = body.priority ?? undefined;
  if (priority !== undefined && (typeof priority !== "string" || !PRIORITIES.includes(priority))) return fail(400, "priority must be high, medium, low or null");
  const dueDate = time(body.dueDate, "dueDate");
  if (!dueDate.ok) return dueDate;
  const recurrence = recurrenceInput(body.recurrence);
  if (!recurrence.ok) return recurrence;

  let parentId: string | undefined;
  if (current) {
    if (has(body, "parent") && !jsonEqual(body.parent, current.parent)) return fail(409, "An item's parent can't be changed");
  } else if (body.parent !== undefined && body.parent !== null) {
    const match = typeof body.parent === "string" && body.parent.startsWith(list) ? new RegExp(`^${ID_SEGMENT}$`).exec(body.parent.slice(list.length)) : null;
    if (!match) return fail(409, "parent must be an item of this list");
    parentId = match[1];
  }

  return {
    ok: true,
    value: {
      name: body.name,
      checked,
      ...(description ? { description } : {}),
      ...(dueDate.value !== undefined ? { dueDate: dueDate.value } : {}),
      ...(url ? { url } : {}),
      ...(priority !== undefined ? { priority: priority as Priority } : {}),
      ...(recurrence.value ? { recurrence: recurrence.value } : {}),
      ...(parentId ? { parentId } : {}),
    },
  };
}

/** Recurrence as an agent sees it, for comparing a request with what is stored (nextDue is never shown). */
export const sameRecurrence = (a: Recurrence | undefined, b: Recurrence | undefined) => jsonEqual(recurrenceView(a), recurrenceView(b));
