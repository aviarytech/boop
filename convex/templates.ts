import { actorMutation, actorQuery } from "./lib/authenticated";
/**
 * List templates - save and reuse list structures.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { BUILTIN_TEMPLATES } from "./lib/templateCatalog";
import { assertListQuota, createListOwnershipVC, grantFirstListReferral } from "./lists";
import { createItemAuthorshipVC } from "./items";
import { upsertListEnvelope } from "./lib/listEnvelope";
// Id type used in function arguments via v.id()

const templateItemValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
  order: v.number(),
});

/**
 * Create a template from an existing list.
 */
export const { public: createFromList, internal: createFromListInternal } = actorMutation({
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    templateName: v.string(),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    // Get all items from the list
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Filter out checked items and sub-items, only keep top-level unchecked items
    const templateItems = items
      .filter((item) => !item.checked && !item.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((item, index) => ({
        name: item.name,
        description: item.description,
        priority: item.priority,
        order: index,
      }));

    return await ctx.db.insert("listTemplates", {
      name: args.templateName,
      description: args.description,
      ownerDid: ctx.actor.did,
      items: templateItems,
      createdAt: Date.now(),
      isPublic: args.isPublic ?? false,
    });
  },
});

/**
 * Create a new template manually.
 */
export const { public: createTemplate, internal: createTemplateInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    items: v.array(templateItemValidator),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("listTemplates", {
      name: args.name,
      description: args.description,
      ownerDid: ctx.actor.did,
      items: args.items,
      createdAt: Date.now(),
      isPublic: args.isPublic ?? false,
    });
  },
});

/**
 * Update a template.
 */
export const { public: updateTemplate, internal: updateTemplateInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    templateId: v.id("listTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    items: v.optional(v.array(templateItemValidator)),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (![ctx.actor.did, ctx.actor.legacyDid].includes(template.ownerDid)) {
      throw new Error("Not authorized to update this template");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.items !== undefined) updates.items = args.items;
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic;

    await ctx.db.patch(args.templateId, updates);
    return args.templateId;
  },
});

/**
 * Delete a template.
 */
export const { public: deleteTemplate, internal: deleteTemplateInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    templateId: v.id("listTemplates"),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (![ctx.actor.did, ctx.actor.legacyDid].includes(template.ownerDid)) {
      throw new Error("Not authorized to delete this template");
    }

    await ctx.db.delete(args.templateId);
  },
});

/**
 * Get user's templates.
 */
export const { public: getUserTemplates, internal: getUserTemplatesInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: {},
  handler: async (ctx) => {
    const dids = [ctx.actor.did, ctx.actor.legacyDid].filter((did): did is string => !!did);
    return (await Promise.all(dids.map(did => ctx.db.query("listTemplates")
      .withIndex("by_owner", q => q.eq("ownerDid", did)).collect()))).flat();
  },
});

/**
 * Get public templates.
 */
export const getPublicTemplates = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("listTemplates")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .collect();
  },
});

/**
 * Get a single template.
 */
export const { public: getTemplate, internal: getTemplateInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: { templateId: v.id("listTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (template && !template.isPublic && ![ctx.actor.did, ctx.actor.legacyDid].includes(template.ownerDid)) throw new Error("Not authorized to read this template");
    return template;
  },
});

/**
 * Create a new list from a template.
 */
export const { public: createListFromTemplate, internal: createListFromTemplateInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    templateId: v.optional(v.id("listTemplates")),
    builtinId: v.optional(v.string()),
    expectedOwnerDid: v.optional(v.string()),
    listName: v.string(),
    // Genesis happens client-side (only the client holds the key), same as lists.createList.
    assetDid: v.string(),
    celEnvelope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.expectedOwnerDid && args.expectedOwnerDid !== ctx.actor.did) throw new Error("Account changed; select the template again");
    const templateSource = args.builtinId ? `builtin:${args.builtinId}` : `saved:${args.templateId}`;
    if (!!args.templateId === !!args.builtinId) throw new Error("Choose exactly one template");
    const template = args.builtinId
      ? BUILTIN_TEMPLATES.find(t => t.id === args.builtinId)
      : await ctx.db.get(args.templateId!);
    if (!template) throw new Error("Template not found");
    if ("ownerDid" in template && !template.isPublic && ![ctx.actor.did, ctx.actor.legacyDid].includes(template.ownerDid)) {
      throw new Error("Not authorized to use this template");
    }
    if (!args.listName.trim() || args.listName.length > 200) throw new Error("List name must be between 1 and 200 characters");
    // A client retains the minted asset across transport retries. Convex serializes
    // this indexed read with insertion, so concurrent retries create one list.
    const existing = await ctx.db.query("lists").withIndex("by_asset_did", q => q.eq("assetDid", args.assetDid)).first();
    if (existing) {
      if (existing.ownerDid !== ctx.actor.did || existing.templateSource !== templateSource) throw new Error("Asset already used");
      return existing._id;
    }
    const { owner, isFirstList } = await assertListQuota(ctx, ctx.actor.did);

    const now = Date.now();

    // Create the list
    const listId = await ctx.db.insert("lists", {
      assetDid: args.assetDid,
      templateSource,
      name: args.listName,
      ownerDid: ctx.actor.did,
      createdAt: now,
    });

    await ctx.db.patch(listId, { vcProof: createListOwnershipVC(listId, args.assetDid, ctx.actor.did, args.listName, now) });
    if (args.celEnvelope) {
      await upsertListEnvelope(ctx, listId, args.assetDid, args.celEnvelope);
    }

    // Create items from template
    for (const templateItem of template.items) {
      const itemId = await ctx.db.insert("items", {
        listId,
        name: templateItem.name,
        description: templateItem.description,
        priority: templateItem.priority,
        checked: false,
        createdByDid: ctx.actor.did,
        createdAt: now,
        updatedAt: now,
        assignmentsVersion: 1,
        order: templateItem.order,
      });
      // Preserve the same historical authorship record as ordinary item creation.
      // This is the existing unsigned placeholder, not a new signature claim.
      await ctx.db.patch(itemId, {
        vcProofs: [createItemAuthorshipVC(itemId, listId, ctx.actor.did, templateItem.name, now)],
      });
    }

    await grantFirstListReferral(ctx, owner, isFirstList);
    return listId;
  },
});
