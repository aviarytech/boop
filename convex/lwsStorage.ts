/**
 * LWS storage operations (docs/lws-agent-auth.md "Storage"), behind the HTTP
 * adapter in lwsStorageHttp.ts. Internal only.
 *
 * Each function authenticates the agent's access token in its own transaction,
 * checks that the token is for this storage and carries the scope, resolves
 * the resource (the user's own, non-note lists only), evaluates preconditions
 * against the representation as it stands in this transaction, and only then
 * writes, through the same item operations the app uses (convex/items.ts). A
 * concurrent write invalidates the read set, so Convex retries the mutation
 * and the retry sees the new ETag: a stale If-Match is a 412, never a lost
 * update. Every failure is thrown (lib/lwsStorage.ts lwsFailure), so nothing
 * a failed request did is committed.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authenticateAgentToken, type ResolvedActor } from "./lib/actor";
import type { ActorCtx } from "./lib/authenticated";
import { authorizeResources } from "./lib/permissions";
import { authErrorData } from "./lib/authError";
import { isNote } from "./lib/noteBody";
import { accessRequestsUri, storageUri } from "./lib/lwsUrls";
import { LWS_JSON, type CanonicalAction } from "./lib/lwsAccess";
import {
  applyJsonPatch, entityTag, evaluatePreconditions, hasPreconditions, itemDocument, itemModified, jsonEqual,
  linksetDocument, listContainerDocument, listModified, lwsFailure, mergePatch, notFound, parseItemInput,
  parseTarget, rootContainerDocument, sameRecurrence, storageDescription, itemUri, listUri,
  JSON_MEDIA, LINKSET_JSON, LWS_CID, MAX_CREATE_DESCRIPTION,
  type ItemDocument, type Preconditions, type ResourceTarget, type Validators,
} from "./lib/lwsStorage";
import { addItemOperation, checkItemOperation, removeItemOperation, uncheckItemOperation, updateItemOperation } from "./items";
import { storageAccount } from "./lwsAccess";

/** How often a request may record that an agent was used. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

const preconditions = v.object({
  ifMatch: v.optional(v.string()),
  ifNoneMatch: v.optional(v.string()),
  ifModifiedSince: v.optional(v.string()),
  ifUnmodifiedSince: v.optional(v.string()),
});

export type Representation = Validators & { contentType: string; body: string };
/**
 * A write's result. `readable` is whether the agent may also read: if not,
 * `body` is empty and the response carries none (204, or 201 without a body).
 */
export type WriteResult = Representation & { readable: boolean };

/**
 * The agent behind a token, for this storage, holding this action. A token
 * for another storage fails audience validation (LWS Authorization
 * "Validation"): 401 invalid_token, like an unknown one. Each operation names
 * the one action it needs: every read `read`, POST `create`, PUT and PATCH
 * `update` (`modify` is the same action), DELETE `delete`.
 */
async function agentFor(ctx: QueryCtx | MutationCtx, agentToken: string, userPath: string, action: CanonicalAction) {
  let resolved;
  try {
    resolved = await authenticateAgentToken(ctx, agentToken);
  } catch (error) {
    if (authErrorData(error)) throw lwsFailure(401, "Invalid access token", undefined, "invalid_token");
    throw error;
  }
  const storage = storageUri(userPath);
  if (resolved.token.storage !== storage) throw lwsFailure(401, "Invalid access token", "The token is for another storage", "invalid_token");
  if (!resolved.actions.includes(action)) throw lwsFailure(403, "Insufficient scope", `This needs the ${action} action`, "insufficient_scope");
  return { ...resolved, storage, canRead: resolved.actions.includes("read") };
}

/** A write's representation, for an agent that may read it; otherwise only its validators. */
const writeResult = (representation: Representation, readable: boolean): WriteResult =>
  readable ? { ...representation, readable } : { ...representation, body: "", readable };

/** One of the user's own lists, not a note; anything else is indistinguishable from none. */
async function ownList(ctx: QueryCtx | MutationCtx, actor: ResolvedActor, rawId: string): Promise<Doc<"lists">> {
  const listId = ctx.db.normalizeId("lists", rawId);
  const list = listId ? await ctx.db.get(listId) : null;
  if (!list || isNote(list) || (list.ownerDid !== actor.did && list.ownerDid !== actor.legacyDid)) throw notFound();
  try {
    // The shared rule too: an agent may touch only lists the user owns, and not while the account is being erased.
    await authorizeResources(ctx, actor, { lists: [list._id] }, "owner");
  } catch (error) {
    if (authErrorData(error)) throw notFound();
    throw error;
  }
  return list;
}

async function ownItem(ctx: QueryCtx | MutationCtx, list: Doc<"lists">, rawId: string): Promise<Doc<"items">> {
  const itemId = ctx.db.normalizeId("items", rawId);
  const item = itemId ? await ctx.db.get(itemId) : null;
  if (!item || item.listId !== list._id) throw notFound();
  return item;
}

const listItems = (ctx: QueryCtx | MutationCtx, listId: Id<"lists">) =>
  ctx.db.query("items").withIndex("by_list", q => q.eq("listId", listId)).collect();

async function json(contentType: string, document: unknown, lastModified: number, lastModifiedExact: boolean): Promise<Representation> {
  const body = JSON.stringify(document);
  return { contentType, body, etag: await entityTag(body), lastModified, lastModifiedExact };
}

const itemRepresentation = (storage: string, item: Doc<"items">) =>
  json(JSON_MEDIA, itemDocument(storage, item), itemModified(item), true);

async function listRepresentation(ctx: QueryCtx | MutationCtx, storage: string, list: Doc<"lists">): Promise<Representation> {
  const items = await listItems(ctx, list._id);
  // Deleting an item leaves no time behind, so a container's Last-Modified is
  // a lower bound and only its ETag is used as a validator.
  return json(LWS_JSON, listContainerDocument(storage, list, items), listModified(list, items), false);
}

async function rootRepresentation(ctx: QueryCtx | MutationCtx, storage: string, actor: ResolvedActor): Promise<Representation> {
  const owners = [actor.did, ...(actor.legacyDid && actor.legacyDid !== actor.did ? [actor.legacyDid] : [])];
  const lists = (await Promise.all(owners.map(did => ctx.db.query("lists").withIndex("by_owner", q => q.eq("ownerDid", did)).collect())))
    .flat().filter(list => !isNote(list));
  const entries = await Promise.all(lists.map(async list => ({ list, modified: listModified(list, await listItems(ctx, list._id)) })));
  const user = await ctx.db.get(actor.userId);
  const lastModified = Math.max(user?.createdAt ?? 0, ...entries.map(entry => entry.modified));
  return json(LWS_JSON, rootContainerDocument(storage, entries), lastModified, false);
}

/** The resource a non-description target names, after checking it is the agent's to see. */
async function resource(ctx: QueryCtx | MutationCtx, storage: string, actor: ResolvedActor, target: ResourceTarget) {
  if (target.kind === "root") return { target, representation: await rootRepresentation(ctx, storage, actor) };
  const list = await ownList(ctx, actor, target.listId);
  if (target.kind === "list") return { target, list, representation: await listRepresentation(ctx, storage, list) };
  const item = await ownItem(ctx, list, target.itemId);
  return { target, list, item, representation: await itemRepresentation(storage, item) };
}

function resourceTarget(subpath: string): ResourceTarget & { linkset: boolean } {
  const target = parseTarget(subpath);
  if (!target || target.kind === "description") throw notFound();
  return target;
}

function requirePreconditions(p: Preconditions, current: Validators) {
  if (evaluatePreconditions(p, current, false) !== "proceed") throw lwsFailure(412, "Precondition failed", "The resource has changed");
}

/** The actor context the item operations take, with the agent's credential for attribution. */
async function actorContext(ctx: MutationCtx, actor: ResolvedActor, agent: Doc<"lwsAgents">, agentToken: string): Promise<ActorCtx<MutationCtx>> {
  const now = Date.now();
  // Last use is recorded at token exchange and, at most once a minute, on writes.
  if (agent.lastUsedAt === undefined || now - agent.lastUsedAt >= LAST_USED_RESOLUTION_MS) await ctx.db.patch(agent._id, { lastUsedAt: now });
  return Object.assign({}, ctx, { actor, credentials: { agentToken } });
}

/** GET B/lws/{u}: public. Null when the path serves no author DID. */
export const describeStorage = internalQuery({
  args: { userPath: v.string() },
  handler: async (ctx, args): Promise<Representation | null> => {
    const account = await storageAccount(ctx, args.userPath);
    if (!account) return null;
    return json(LWS_CID, storageDescription(storageUri(args.userPath), accessRequestsUri()), account.log.updatedAt, false);
  },
});

/** GET/HEAD on a container, an item, or a linkset. */
export const read = internalQuery({
  args: { agentToken: v.string(), userPath: v.string(), subpath: v.string() },
  handler: async (ctx, args): Promise<Representation> => {
    const target = resourceTarget(args.subpath);
    const { actor, storage } = await agentFor(ctx, args.agentToken, args.userPath, "read");
    const found = await resource(ctx, storage, actor, target);
    if (!target.linkset) return found.representation;
    return json(LINKSET_JSON, linksetDocument(storage, target), found.representation.lastModified, false);
  },
});

/**
 * PATCH on a linkset (JSON Patch). Every link boop serves is server-managed,
 * so a patch is accepted only if it changes nothing (say, only `test`s); any
 * change is a 409. Nothing is written, so this is a query.
 */
export const patchLinkset = internalQuery({
  args: { agentToken: v.string(), userPath: v.string(), subpath: v.string(), patch: v.string(), preconditions },
  handler: async (ctx, args): Promise<Representation> => {
    const target = resourceTarget(args.subpath);
    if (!target.linkset) throw notFound();
    const { actor, storage, canRead } = await agentFor(ctx, args.agentToken, args.userPath, "update");
    const found = await resource(ctx, storage, actor, target);
    const document = linksetDocument(storage, target);
    const current = await json(LINKSET_JSON, document, found.representation.lastModified, false);
    requirePreconditions(args.preconditions, current);
    const patch = parseBody(args.patch);
    requireReadForTests(patch, canRead);
    const patched = applyJsonPatch(document, patch);
    if (!patched.ok) throw lwsFailure(patched.status, patched.status === 400 ? "Invalid patch" : "Patch does not apply", patched.detail);
    if (!jsonEqual(patched.value, document)) throw lwsFailure(409, "Links are server-managed", "boop doesn't allow clients to change any link, including up");
    return current;
  },
});

function parseBody(text: string): unknown {
  try { return JSON.parse(text); } catch { throw lwsFailure(400, "Invalid JSON", "The body is not JSON"); }
}

/** A JSON Patch `test` reads the document: an agent without `read` may not use one. */
function requireReadForTests(patch: unknown, canRead: boolean) {
  if (canRead || !Array.isArray(patch)) return;
  if (patch.some(op => typeof op === "object" && op !== null && (op as { op?: unknown }).op === "test")) {
    throw lwsFailure(403, "Insufficient scope", "A test operation needs the read action", "insufficient_scope");
  }
}

/** Check a parent named at creation: an item of the same list, itself top-level (items nest one level). */
async function checkParent(ctx: MutationCtx, list: Doc<"lists">, rawId: string): Promise<Id<"items">> {
  const id = ctx.db.normalizeId("items", rawId);
  const parent = id ? await ctx.db.get(id) : null;
  if (!parent || parent.listId !== list._id) throw lwsFailure(409, "No such parent", "parent must be an item of this list");
  if (parent.parentId) throw lwsFailure(409, "Too deep", "Items nest one level deep: parent is itself a sub-item");
  return parent._id;
}

/** POST B/lws/{u}/{listId}/: create an item. Returns its URI and representation. */
export const createItem = internalMutation({
  args: { agentToken: v.string(), userPath: v.string(), subpath: v.string(), body: v.string(), preconditions },
  handler: async (ctx, args): Promise<WriteResult & { location: string; listId: string; itemId: string }> => {
    const target = resourceTarget(args.subpath);
    if (target.kind !== "list" || target.linkset) throw notFound();
    const { actor, agent, storage, canRead } = await agentFor(ctx, args.agentToken, args.userPath, "create");
    const list = await ownList(ctx, actor, target.listId);
    if (hasPreconditions(args.preconditions)) requirePreconditions(args.preconditions, await listRepresentation(ctx, storage, list));
    const input = parseItemInput(parseBody(args.body), listUri(storage, list._id));
    if (!input.ok) throw lwsFailure(input.status, "Invalid item", input.detail);
    const fields = input.value;
    const parentId = fields.parentId ? await checkParent(ctx, list, fields.parentId) : undefined;

    const actorCtx = await actorContext(ctx, actor, agent, args.agentToken);
    const now = Date.now();
    const longDescription = fields.description !== undefined && fields.description.length > MAX_CREATE_DESCRIPTION;
    const itemId = await addItemOperation(actorCtx, {
      listId: list._id, name: fields.name, createdAt: now,
      description: longDescription ? undefined : fields.description,
      dueDate: fields.dueDate, url: fields.url, recurrence: fields.recurrence, priority: fields.priority, parentId,
    });
    if (longDescription) await updateItemOperation(actorCtx, { itemId, description: fields.description });
    if (fields.checked) await checkItemOperation(actorCtx, { itemId, checkedAt: now });
    const item = (await ctx.db.get(itemId))!;
    return { ...writeResult(await itemRepresentation(storage, item), canRead), location: itemUri(storage, list._id, itemId), listId: list._id, itemId };
  },
});

/** PUT, or PATCH (merge patch or JSON Patch), on an item. Returns the new representation. */
export const writeItem = internalMutation({
  args: {
    agentToken: v.string(), userPath: v.string(), subpath: v.string(),
    mode: v.union(v.literal("put"), v.literal("merge-patch"), v.literal("json-patch")),
    body: v.string(), preconditions,
  },
  handler: async (ctx, args): Promise<WriteResult> => {
    const target = resourceTarget(args.subpath);
    if (target.kind !== "item" || target.linkset) throw notFound();
    const { actor, agent, storage, canRead } = await agentFor(ctx, args.agentToken, args.userPath, "update");
    const list = await ownList(ctx, actor, target.listId);
    const item = await ownItem(ctx, list, target.itemId);
    requirePreconditions(args.preconditions, await itemRepresentation(storage, item));

    const current: ItemDocument = itemDocument(storage, item);
    const body = parseBody(args.body);
    let next: unknown = body;
    if (args.mode === "merge-patch") next = mergePatch(current, body);
    if (args.mode === "json-patch") {
      requireReadForTests(body, canRead);
      const patched = applyJsonPatch(current, body);
      if (!patched.ok) throw lwsFailure(patched.status, patched.status === 400 ? "Invalid patch" : "Patch does not apply", patched.detail);
      next = patched.value;
    }
    const input = parseItemInput(next, listUri(storage, list._id), current);
    if (!input.ok) throw lwsFailure(input.status, "Invalid item", input.detail);
    const fields = input.value;

    // The app's own operations, in this transaction: details first, so a
    // recurring item checked in the same request copies the new details.
    const update: Parameters<typeof updateItemOperation>[1] = { itemId: item._id };
    if (fields.name !== item.name) update.name = fields.name;
    if ((fields.description ?? "") !== (item.description ?? "")) update.description = fields.description ?? "";
    if (fields.dueDate !== item.dueDate) { if (fields.dueDate === undefined) update.clearDueDate = true; else update.dueDate = fields.dueDate; }
    if ((fields.url ?? "") !== (item.url ?? "")) { if (fields.url === undefined) update.clearUrl = true; else update.url = fields.url; }
    if (fields.priority !== item.priority) { if (fields.priority === undefined) update.clearPriority = true; else update.priority = fields.priority; }
    if (!sameRecurrence(fields.recurrence, item.recurrence)) { if (fields.recurrence === undefined) update.clearRecurrence = true; else update.recurrence = fields.recurrence; }
    const detailsChange = Object.keys(update).length > 1;
    const checkChange = fields.checked !== item.checked;
    if (!detailsChange && !checkChange) return writeResult(await itemRepresentation(storage, item), canRead);

    const actorCtx = await actorContext(ctx, actor, agent, args.agentToken);
    if (detailsChange) await updateItemOperation(actorCtx, update);
    if (checkChange) {
      if (fields.checked) await checkItemOperation(actorCtx, { itemId: item._id, checkedAt: Date.now() });
      else await uncheckItemOperation(actorCtx, { itemId: item._id });
    }
    return writeResult(await itemRepresentation(storage, (await ctx.db.get(item._id))!), canRead);
  },
});

/** DELETE on an item. An item with sub-items is a 409: delete them first. */
export const deleteItem = internalMutation({
  args: { agentToken: v.string(), userPath: v.string(), subpath: v.string(), preconditions },
  handler: async (ctx, args): Promise<null> => {
    const target = resourceTarget(args.subpath);
    if (target.kind !== "item" || target.linkset) throw notFound();
    const { actor, agent, storage } = await agentFor(ctx, args.agentToken, args.userPath, "delete");
    const list = await ownList(ctx, actor, target.listId);
    const item = await ownItem(ctx, list, target.itemId);
    requirePreconditions(args.preconditions, await itemRepresentation(storage, item));
    if (await ctx.db.query("items").withIndex("by_parent", q => q.eq("parentId", item._id)).first()) {
      throw lwsFailure(409, "Item has sub-items", "Delete its sub-items first");
    }
    await removeItemOperation(await actorContext(ctx, actor, agent, args.agentToken), { itemId: item._id });
    return null;
  },
});
