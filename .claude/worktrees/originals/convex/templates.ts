/**
 * List templates - save and reuse list structures.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
export const createFromList = mutation({
  args: {
    listId: v.id("lists"),
    templateName: v.string(),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    userDid: v.string(),
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
      ownerDid: args.userDid,
      items: templateItems,
      createdAt: Date.now(),
      isPublic: args.isPublic ?? false,
    });
  },
});

/**
 * Create a new template manually.
 */
export const createTemplate = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    items: v.array(templateItemValidator),
    isPublic: v.optional(v.boolean()),
    userDid: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("listTemplates", {
      name: args.name,
      description: args.description,
      ownerDid: args.userDid,
      items: args.items,
      createdAt: Date.now(),
      isPublic: args.isPublic ?? false,
    });
  },
});

/**
 * Update a template.
 */
export const updateTemplate = mutation({
  args: {
    templateId: v.id("listTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    items: v.optional(v.array(templateItemValidator)),
    isPublic: v.optional(v.boolean()),
    userDid: v.string(),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.ownerDid !== args.userDid) {
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
export const deleteTemplate = mutation({
  args: {
    templateId: v.id("listTemplates"),
    userDid: v.string(),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.ownerDid !== args.userDid) {
      throw new Error("Not authorized to delete this template");
    }

    await ctx.db.delete(args.templateId);
  },
});

/**
 * Get user's templates.
 */
export const getUserTemplates = query({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("listTemplates")
      .withIndex("by_owner", (q) => q.eq("ownerDid", args.userDid))
      .collect();
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
export const getTemplate = query({
  args: { templateId: v.id("listTemplates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.templateId);
  },
});

/**
 * Create a new list from a template.
 */
export const createListFromTemplate = mutation({
  args: {
    templateId: v.id("listTemplates"),
    listName: v.string(),
    userDid: v.string(),
    // Genesis happens client-side (only the client holds the key), same as lists.createList.
    assetDid: v.string(),
    celEnvelope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    // Check if template is accessible
    if (!template.isPublic && template.ownerDid !== args.userDid) {
      throw new Error("Not authorized to use this template");
    }

    const now = Date.now();

    // Create the list
    const listId = await ctx.db.insert("lists", {
      assetDid: args.assetDid,
      name: args.listName,
      ownerDid: args.userDid,
      createdAt: now,
    });

    if (args.celEnvelope) {
      await upsertListEnvelope(ctx, listId, args.assetDid, args.celEnvelope);
    }

    // Create items from template
    for (const templateItem of template.items) {
      await ctx.db.insert("items", {
        listId,
        name: templateItem.name,
        description: templateItem.description,
        priority: templateItem.priority,
        checked: false,
        createdByDid: args.userDid,
        createdAt: now,
        order: templateItem.order,
      });
    }

    return listId;
  },
});
