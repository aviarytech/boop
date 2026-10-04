import { changeAssignments, deleteAssignments, inheritedAssignmentFields, insertInheritedAssignments, withAssignments, withAssignmentsBatch } from "./lib/assignments";
import { getReplaySequence } from "./lib/replay";
import { noteConflict } from "./lib/noteConflict";
import { resourceUnavailable } from "./lib/authError";
import { actorMutation, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import { withMutationObservability } from "./lib/observability";
import { canUserEditList } from "./lib/permissions";
import { MAX_NOTE_LENGTH, isNote } from "./lib/noteBody";

/**
 * Creates a Verifiable Credential for item authorship (creation).
 * 
 * This follows the W3C VC Data Model structure with a placeholder proof.
 * The proof can be replaced with a cryptographic signature when server-side
 * signing is implemented.
 * 
 * @see https://www.w3.org/TR/vc-data-model/
 */
function createItemAuthorshipVC(
  itemId: Id<"items">,
  listId: Id<"lists">,
  creatorDid: string,
  itemName: string,
  createdAt: number
): {
  type: string;
  issuer: string;
  issuanceDate: number;
  action: string;
  actorDid: string;
  proof?: string;
} {
  // Build the full W3C VC for signing/verification
  const fullVc = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://originals.tech/credentials/v1"
    ],
    type: ["VerifiableCredential", "ItemAuthorshipCredential"],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: creatorDid,
    issuanceDate: new Date(createdAt).toISOString(),
    credentialSubject: {
      id: creatorDid,
      itemId: itemId.toString(),
      listId: listId.toString(),
      itemName,
      action: "created",
    },
  };

  // Return the structured VC object for storage
  return {
    type: "ItemAuthorshipCredential",
    issuer: creatorDid,
    issuanceDate: createdAt,
    action: "created",
    actorDid: creatorDid,
    proof: JSON.stringify(fullVc),
  };
}

/**
 * Creates a Verifiable Credential for item completion.
 * 
 * This follows the W3C VC Data Model structure with a placeholder proof.
 * The proof can be replaced with a cryptographic signature when server-side
 * signing is implemented.
 * 
 * @see https://www.w3.org/TR/vc-data-model/
 */
function createItemCompletionVC(
  itemId: Id<"items">,
  listId: Id<"lists">,
  completerDid: string,
  itemName: string,
  checkedAt: number
): {
  type: string;
  issuer: string;
  issuanceDate: number;
  action: string;
  actorDid: string;
  proof?: string;
} {
  // Build the full W3C VC for signing/verification
  const fullVc = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://originals.tech/credentials/v1"
    ],
    type: ["VerifiableCredential", "ItemCompletionCredential"],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: completerDid,
    issuanceDate: new Date(checkedAt).toISOString(),
    credentialSubject: {
      id: completerDid,
      itemId: itemId.toString(),
      listId: listId.toString(),
      itemName,
      action: "completed",
    },
  };

  // Return the structured VC object for storage
  return {
    type: "ItemCompletionCredential",
    issuer: completerDid,
    issuanceDate: checkedAt,
    action: "completed",
    actorDid: completerDid,
    proof: JSON.stringify(fullVc),
  };
}

/**
 * Add an item to a list.
 * Supports legacy DID for migrated users.
 */
export const { public: addItem, internal: addItemInternal, replay: addItemReplay } = actorMutation({
  offlineOperation: "addItem",
  resources: args => ({ lists: [args.listId], items: [args.parentId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    name: v.string(),
    createdAt: v.number(),
    // Optional enhanced fields
    description: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    url: v.optional(v.string()),
    recurrence: v.optional(v.object({
      frequency: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
      interval: v.optional(v.number()),
      nextDue: v.optional(v.number()),
      endDate: v.optional(v.number()),
    })),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    assigneeDid: v.optional(v.string()),
    assigneeDids: v.optional(v.array(v.string())),
    parentId: v.optional(v.id("items")), // For sub-items
  },
  handler: async (ctx, args) => withMutationObservability("items.addItem", async () => {
    // Input validation
    if (args.name.trim().length === 0) throw new Error("Item name cannot be empty");
    if (args.name.length > 500) throw new Error("Item name cannot exceed 500 characters");
    // addItem is the quick-entry form; the full markdown editor (NoteEditor) edits
    // via updateItem, which allows up to 50000 chars. The caps differ on purpose.
    if (args.description && args.description.length > 2000) throw new Error("Description cannot exceed 2000 characters");
    if (args.url && args.url.length > 2000) throw new Error("URL cannot exceed 2000 characters");

    // Verify the list exists
    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    // Notes are uncapped, so items on one would be an unmetered list.
    if (isNote(list)) throw new Error("Cannot add items to a note");

    // Verify user is authorized (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      args.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canEdit) {
      throw resourceUnavailable();
    }

    // If it's a sub-item, verify parent exists and belongs to same list
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.listId !== args.listId) {
        throw new Error("Parent item not found or belongs to different list");
      }
    }

    // Get min order to add new item at the top (for items with same parent)
    const existingItems = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    const sameParentItems = existingItems.filter(i => i.parentId === args.parentId);
    const minOrder = sameParentItems.reduce(
      (min, item) => Math.min(min, item.order ?? 0),
      0
    );

    const now = Date.now();
    const itemId = await ctx.db.insert("items", {
      listId: args.listId,
      name: args.name,
      checked: false,
      createdByDid: ctx.actor.did,
      checkedByDid: undefined,
      createdAt: args.createdAt,
      checkedAt: undefined,
      order: minOrder - 1,
      updatedAt: now,
      // Enhanced fields
      description: args.description,
      dueDate: args.dueDate,
      url: args.url,
      recurrence: args.recurrence,
      priority: args.priority,
      assignmentsVersion: 1,
      parentId: args.parentId,
    });

    await changeAssignments(ctx, (await ctx.db.get(itemId))!, ctx.actor.did, { replace: args.assigneeDids ?? (args.assigneeDid ? [args.assigneeDid] : []) });

    // Issue Verifiable Credential proving item authorship
    const authorshipVC = createItemAuthorshipVC(
      itemId,
      args.listId,
      ctx.actor.did,
      args.name,
      args.createdAt
    );

    // Store the VC proof on the item
    await ctx.db.patch(itemId, { vcProofs: [authorshipVC] });

    // Notify other list members (fire-and-forget via scheduler)
    await ctx.scheduler.runAfter(0, internal.notificationActions.sendListNotificationInternal, {
      listId: args.listId,
      excludeDid: ctx.actor.did,
      title: list.name,
      body: `"${args.name}" was added`,
      data: { listId: args.listId },
    });

    return itemId;
  }),
});

/**
 * Update an item's details (name, description, due date, url, recurrence, priority).
 * Supports legacy DID for migrated users.
 */
export const { public: updateItem, internal: updateItemInternal, replay: updateItemReplay } = actorMutation({
  offlineOperation: "updateItem",
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    // Fields that can be updated
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    expectedDescription: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    url: v.optional(v.string()),
    recurrence: v.optional(v.object({
      frequency: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
      interval: v.optional(v.number()),
      nextDue: v.optional(v.number()),
      endDate: v.optional(v.number()),
    })),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    groceryAisle: v.optional(v.string()),
    assigneeDid: v.optional(v.string()),
    assigneeDids: v.optional(v.array(v.string())),
    clearGroceryAisle: v.optional(v.boolean()),
    clearDueDate: v.optional(v.boolean()),
    clearRecurrence: v.optional(v.boolean()),
    clearUrl: v.optional(v.boolean()),
    clearPriority: v.optional(v.boolean()),
    clearAssigneeDid: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => withMutationObservability("items.updateItem", async () => {
    if (args.description !== undefined && args.description.length > MAX_NOTE_LENGTH) {
      throw new Error(`Description cannot exceed ${MAX_NOTE_LENGTH} characters`);
    }
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) {
      throw resourceUnavailable();
    }

    if (args.description !== undefined && args.expectedDescription !== undefined &&
        (item.description ?? "") !== args.expectedDescription) {
      throw noteConflict();
    }
    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
    if (args.url !== undefined) updates.url = args.url;
    if (args.recurrence !== undefined) updates.recurrence = args.recurrence;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.groceryAisle !== undefined) updates.groceryAisle = args.groceryAisle;

    // Clear fields if requested
    if (args.clearDueDate) updates.dueDate = undefined;
    if (args.clearRecurrence) updates.recurrence = undefined;
    if (args.clearUrl) updates.url = undefined;
    if (args.clearPriority) updates.priority = undefined;
    if (args.clearGroceryAisle) updates.groceryAisle = undefined;

    if (args.assigneeDids !== undefined) {
      await changeAssignments(ctx, item, ctx.actor.did, { replace: args.assigneeDids });
    } else if (args.assigneeDid !== undefined || args.clearAssigneeDid) {
      await changeAssignments(ctx, item, ctx.actor.did, { legacy: args.clearAssigneeDid ? null : args.assigneeDid });
    }
    await ctx.db.patch(args.itemId, updates);
    return args.itemId;
  }),
});

/**
 * Calculate the next due date based on recurrence settings.
 */
function calculateNextDueDate(
  currentDueDate: number | undefined,
  frequency: "daily" | "weekly" | "monthly",
  interval: number = 1
): number {
  // Start from current due date or now if not set
  const baseDate = new Date(currentDueDate ?? Date.now());
  
  switch (frequency) {
    case "daily":
      baseDate.setDate(baseDate.getDate() + interval);
      break;
    case "weekly":
      baseDate.setDate(baseDate.getDate() + (7 * interval));
      break;
    case "monthly":
      baseDate.setMonth(baseDate.getMonth() + interval);
      break;
  }
  
  return baseDate.getTime();
}

/**
 * Check (mark as complete) an item.
 * Supports legacy DID for migrated users.
 * If the item has recurrence settings, creates a new unchecked copy with the next due date.
 */
export const { public: checkItem, internal: checkItemInternal, replay: checkItemReplay } = actorMutation({
  offlineOperation: "checkItem",
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => withMutationObservability("items.checkItem", async () => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Verify user is authorized (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canEdit) {
      throw resourceUnavailable();
    }

    const now = Date.now();

    // Issue Verifiable Credential proving item completion
    const completionVC = createItemCompletionVC(
      args.itemId,
      item.listId,
      ctx.actor.did,
      item.name,
      args.checkedAt
    );

    // Append completion VC to existing proofs (filter out any legacy string-format proofs)
    const existingProofs = (item.vcProofs ?? []).filter(
      (p): p is NonNullable<typeof item.vcProofs>[number] => typeof p === "object" && p !== null
    );
    const updatedProofs = [...existingProofs, completionVC];

    // Mark the current item as checked and add completion VC
    await ctx.db.patch(args.itemId, {
      checked: true,
      checkedByDid: ctx.actor.did,
      checkedAt: args.checkedAt,
      updatedAt: now,
      vcProofs: updatedProofs,
    });

    // Notify other list members about the completion
    const list = await ctx.db.get(item.listId);
    await ctx.scheduler.runAfter(0, internal.notificationActions.sendListNotificationInternal, {
      listId: item.listId,
      excludeDid: ctx.actor.did,
      title: list?.name ?? "Your list",
      body: `"${item.name}" was completed`,
      data: { listId: item.listId },
    });

    // If item has recurrence, create a new unchecked copy with next due date
    if (item.recurrence) {
      const nextDueDate = calculateNextDueDate(
        item.dueDate,
        item.recurrence.frequency,
        item.recurrence.interval ?? 1
      );

      // Check if end date has passed - if so, don't create next occurrence
      const endDate = item.recurrence.endDate;
      if (!endDate || nextDueDate <= endDate) {
        // Get min order to add new item at the top
        const existingItems = await ctx.db
          .query("items")
          .withIndex("by_list", (q) => q.eq("listId", item.listId))
          .collect();
        const sameParentItems = existingItems.filter(i => i.parentId === item.parentId);
        const minOrder = sameParentItems.reduce(
          (min, i) => Math.min(min, i.order ?? 0),
          0
        );

        const { assigneeDids } = await withAssignments(ctx, item);
        // Create the new recurring item
        const nextId = await ctx.db.insert("items", {
          listId: item.listId,
          name: item.name,
          checked: false,
          createdByDid: ctx.actor.did,
          createdAt: now,
          order: minOrder - 1,
          updatedAt: now,
          description: item.description,
          dueDate: nextDueDate,
          url: item.url,
          recurrence: item.recurrence,
          priority: item.priority,
          ...inheritedAssignmentFields(assigneeDids, now),
          tags: item.tags,
          parentId: item.parentId,
        });
        await insertInheritedAssignments(ctx, { sourceId: item._id, targetId: nextId, listId: item.listId,
          assigneeDids, actorDid: ctx.actor.did, assignedAt: now, reason: "recurrence" });
      }
    }
  }),
});

/**
 * Uncheck an item.
 * Supports legacy DID for migrated users.
 */
export const { public: uncheckItem, internal: uncheckItemInternal, replay: uncheckItemReplay } = actorMutation({
  offlineOperation: "uncheckItem",
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Verify user is authorized (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canEdit) {
      throw resourceUnavailable();
    }

    await ctx.db.patch(args.itemId, {
      checked: false,
      checkedByDid: undefined,
      checkedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Remove an item from a list.
 * Supports legacy DID for migrated users.
 */
export const { public: removeItem, internal: removeItemInternal, replay: removeItemReplay } = actorMutation({
  offlineOperation: "removeItem",
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Verify user is authorized (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canEdit) {
      throw resourceUnavailable();
    }

    await deleteAssignments(ctx, args.itemId);
    await ctx.db.delete(args.itemId);
  },
});

/**
 * Get all items for a list, ordered by position.
 */
export const { public: getListItems, internal: getListItemsInternal } = actorQuery({
  resources: args => ({ lists: [args.listId] }),
  scope: "items:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Sort by order (items without order fall back to createdAt)
    return withAssignmentsBatch(ctx, items.sort((a, b) => {
      const orderA = a.order ?? a.createdAt;
      const orderB = b.order ?? b.createdAt;
      return orderA - orderB;
    }));
  },
});

/**
 * Reorder items in a list.
 * Takes the full ordered list of item IDs and updates their order values.
 * Supports legacy DID for migrated users.
 */
export const { public: reorderItems, internal: reorderItemsInternal, replay: reorderItemsReplay } = actorMutation({
  offlineOperation: "reorderItem",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    itemIds: v.array(v.id("items")),
  },
  handler: async (ctx, args) => {
    // Update order for each item
    for (let i = 0; i < args.itemIds.length; i++) {
      const itemId = args.itemIds[i];
      const item = await ctx.db.get(itemId);

      // Verify item belongs to this list
      if (item && item.listId === args.listId) {
        await ctx.db.patch(itemId, { order: i, updatedAt: Date.now() });
      }
    }
  },
});

/**
 * Set the grocery aisle override for an item.
 * Allows users to manually classify items into a different aisle.
 * Pass null/undefined aisleId to clear the override.
 */
export const { public: setAisleOverride, internal: setAisleOverrideInternal } = actorMutation({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    aisleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canEdit) throw resourceUnavailable();

    await ctx.db.patch(args.itemId, {
      groceryAisle: args.aisleId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get an item by ID for sync conflict checking.
 * Missing and inaccessible items have the same response.
 */
export const { public: getItemForSync, internal: getItemForSyncInternal } = actorQuery({
  resources: () => ({}),
  scope: "items:read",
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || !await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid)) throw resourceUnavailable();
    return withAssignments(ctx, item);
  },
});

/**
 * Load a single item for the full-page note editor.
 * Returns null when the item does not exist OR the user cannot edit it
 * (in the current permission model, no edit access == no access).
 */
export const { public: getItemForEditor, internal: getItemForEditorInternal } = actorQuery({
  resources: () => ({}),
  scope: "items:read",
  args: {
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) return null;

    return {
      itemId: item._id,
      name: item.name,
      description: item.description ?? "",
      canEdit,
    };
  },
});

/**
 * Get sub-items for a parent item.
 */
export const { public: getSubItems, internal: getSubItemsInternal } = actorQuery({
  resources: args => ({ items: [args.parentId] }),
  scope: "items:read",
  args: { parentId: v.id("items") },
  handler: async (ctx, args) => {
    const items = await ctx.db.query("items").withIndex("by_parent", q => q.eq("parentId", args.parentId)).collect();
    return withAssignmentsBatch(ctx, items);
  },
});

/**
 * Batch check multiple items at once.
 * Handles recurring items by creating new copies with next due dates.
 */
export const { public: batchCheckItems, internal: batchCheckItemsInternal, replay: batchCheckItemsReplay } = actorMutation({
  offlineOperation: "batchCheckItems",
  resources: args => ({ items: [...args.itemIds] }),
  scope: "items:write",
  args: {
    itemIds: v.array(v.id("items")),
  },
  handler: async (ctx, args) => {
    const checkedAt = Date.now();
    const recurrenceLists = new Map<Id<"lists">, {
      assignments: Map<Id<"items">, string[]>;
      minOrders: Map<Id<"items"> | undefined, number>;
    }>();
    let listId: Id<"lists"> | null = null;

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item) continue;

      // Verify authorization once per list
      if (listId !== item.listId) {
        listId = item.listId;
        const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
        if (!canEdit) {
          throw resourceUnavailable();
        }
      }

      await ctx.db.patch(itemId, {
        checked: true,
        checkedByDid: ctx.actor.did,
        checkedAt,
        updatedAt: checkedAt,
      });

      // If item has recurrence, create a new unchecked copy with next due date
      if (item.recurrence) {
        const nextDueDate = calculateNextDueDate(
          item.dueDate,
          item.recurrence.frequency,
          item.recurrence.interval ?? 1
        );

        // Check if end date has passed
        const endDate = item.recurrence.endDate;
        if (!endDate || nextDueDate <= endDate) {
          let cached = recurrenceLists.get(item.listId);
          if (!cached) {
            const existingItems = await ctx.db.query("items").withIndex("by_list", q => q.eq("listId", item.listId)).collect();
            const hydrated = await withAssignmentsBatch(ctx, existingItems);
            const minOrders = new Map<Id<"items"> | undefined, number>();
            for (const existing of existingItems) {
              minOrders.set(existing.parentId, Math.min(minOrders.get(existing.parentId) ?? 0, existing.order ?? 0));
            }
            cached = { assignments: new Map(hydrated.map(i => [i._id, i.assigneeDids])), minOrders };
            recurrenceLists.set(item.listId, cached);
          }
          const minOrder = cached.minOrders.get(item.parentId) ?? 0;
          const assigneeDids = cached.assignments.get(item._id) ?? [];
          cached.minOrders.set(item.parentId, minOrder - 1);

          // Create the new recurring item
          const nextId = await ctx.db.insert("items", {
            listId: item.listId,
            name: item.name,
            checked: false,
            createdByDid: ctx.actor.did,
            createdAt: checkedAt,
            order: minOrder - 1,
            updatedAt: checkedAt,
            description: item.description,
            dueDate: nextDueDate,
            url: item.url,
            recurrence: item.recurrence,
            priority: item.priority,
            ...inheritedAssignmentFields(assigneeDids, checkedAt),
            tags: item.tags,
            parentId: item.parentId,
          });
          await insertInheritedAssignments(ctx, { sourceId: item._id, targetId: nextId, listId: item.listId,
            assigneeDids, actorDid: ctx.actor.did, assignedAt: checkedAt, reason: "recurrence" });
        }
      }
    }
  },
});

/**
 * Batch uncheck multiple items at once.
 */
export const { public: batchUncheckItems, internal: batchUncheckItemsInternal, replay: batchUncheckItemsReplay } = actorMutation({
  offlineOperation: "batchUncheckItems",
  resources: args => ({ items: [...args.itemIds] }),
  scope: "items:write",
  args: {
    itemIds: v.array(v.id("items")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let listId: Id<"lists"> | null = null;

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item) continue;

      if (listId !== item.listId) {
        listId = item.listId;
        const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
        if (!canEdit) {
          throw resourceUnavailable();
        }
      }

      await ctx.db.patch(itemId, {
        checked: false,
        checkedByDid: undefined,
        checkedAt: undefined,
        updatedAt: now,
      });
    }
  },
});

/**
 * Batch delete multiple items at once.
 */
export const { public: batchDeleteItems, internal: batchDeleteItemsInternal, replay: batchDeleteItemsReplay } = actorMutation({
  offlineOperation: "batchDeleteItems",
  resources: args => ({ items: [...args.itemIds] }),
  scope: "items:write",
  args: {
    itemIds: v.array(v.id("items")),
  },
  handler: async (ctx, args) => {
    let listId: Id<"lists"> | null = null;

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item) continue;

      if (listId !== item.listId) {
        listId = item.listId;
        const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
        if (!canEdit) {
          throw resourceUnavailable();
        }
      }

      // Also delete any sub-items
      const subItems = await ctx.db
        .query("items")
        .withIndex("by_parent", (q) => q.eq("parentId", itemId))
        .collect();
      
      for (const subItem of subItems) {
        await deleteAssignments(ctx, subItem._id);
        await ctx.db.delete(subItem._id);
      }

      await deleteAssignments(ctx, itemId);
      await ctx.db.delete(itemId);
    }
  },
});

/**
 * Get items with due dates for calendar view.
 */
export const { public: getItemsWithDueDates, internal: getItemsWithDueDatesInternal } = actorQuery({
  resources: args => ({ lists: [args.listId] }),
  scope: "items:read",
  args: { 
    listId: v.id("lists"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Filter items with due dates
    let filtered = items.filter((item) => item.dueDate !== undefined);

    // Apply date range filter if provided
    if (args.startDate !== undefined) {
      filtered = filtered.filter((item) => item.dueDate! >= args.startDate!);
    }
    if (args.endDate !== undefined) {
      filtered = filtered.filter((item) => item.dueDate! <= args.endDate!);
    }

    return withAssignmentsBatch(ctx, filtered.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0)));
  },
});

/**
 * Get all high-priority items across all lists the user has access to.
 * Used for Priority Focus mode.
 */
export const { public: getHighPriorityItems, internal: getHighPriorityItemsInternal } = actorQuery({
  resources: () => ({}),
  scope: "items:read",
  args: {},
  handler: async (ctx) => {
    // DIDs to check: current DID and optionally legacy DID
    const didsToCheck = [ctx.actor.did];
    if (ctx.actor.legacyDid) {
      didsToCheck.push(ctx.actor.legacyDid);
    }

    // Get all list IDs the user has access to (owned + bookmarked)
    const listIds = new Set<Id<"lists">>();

    for (const did of didsToCheck) {
      const ownedLists = await ctx.db
        .query("lists")
        .withIndex("by_owner", (q) => q.eq("ownerDid", did))
        .collect();

      for (const list of ownedLists) {
        listIds.add(list._id);
      }

      const bookmarks = await ctx.db
        .query("bookmarks")
        .withIndex("by_user", (q) => q.eq("userDid", did))
        .collect();

      for (const bm of bookmarks) {
        listIds.add(bm.listId);
      }
    }

    // Now fetch high-priority items from all accessible lists
    const highPriorityItems: Array<{
      item: Awaited<ReturnType<typeof withAssignments>>;
      listName: string;
      listId: Id<"lists">;
    }> = [];

    for (const listId of listIds) {
      const list = await ctx.db.get(listId);
      if (!list || !(await canUserEditList(ctx, listId, ctx.actor.did, ctx.actor.legacyDid))) continue;

      const items = await ctx.db
        .query("items")
        .withIndex("by_list", (q) => q.eq("listId", listId))
        .collect();

      // Filter for high priority, unchecked items without a parent (top-level only)
      const highPriority = items.filter(
        (item) => item.priority === "high" && !item.checked && !item.parentId
      );

      for (const item of await withAssignmentsBatch(ctx, highPriority)) {
        highPriorityItems.push({
          item,
          listName: list.name,
          listId: list._id,
        });
      }
    }

    // Sort by due date (soonest first), then by creation date
    return highPriorityItems.sort((a, b) => {
      // Items with due dates come first
      if (a.item?.dueDate && !b.item?.dueDate) return -1;
      if (!a.item?.dueDate && b.item?.dueDate) return 1;
      if (a.item?.dueDate && b.item?.dueDate) {
        return a.item.dueDate - b.item.dueDate;
      }
      // Then by creation date (oldest first for backlog items)
      return (a.item?.createdAt ?? 0) - (b.item?.createdAt ?? 0);
    });
  },
});

/**
 * Promote an item to a top-level item (remove parent).
 */
export const { public: promoteItem, internal: promoteItemInternal } = actorMutation({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) {
      throw resourceUnavailable();
    }

    // Remove parent to make it top-level
    await ctx.db.patch(args.itemId, {
      parentId: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Demote an item to become a subtask of another item.
 * Ensures we don't exceed max nesting depth (2 levels).
 */
export const { public: demoteItem, internal: demoteItemInternal } = actorMutation({
  resources: args => ({ items: [args.itemId, args.newParentId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    newParentId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const newParent = await ctx.db.get(args.newParentId);
    if (!newParent) {
      throw new Error("Parent item not found");
    }

    // Verify both items are in the same list
    if (item.listId !== newParent.listId) {
      throw new Error("Items must be in the same list");
    }

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) {
      throw resourceUnavailable();
    }

    // Check nesting depth: new parent can't already have a parent (max 2 levels)
    if (newParent.parentId) {
      throw new Error("Cannot nest more than 2 levels deep");
    }

    // Prevent circular nesting: can't make an item a child of its own child
    const childItems = await ctx.db
      .query("items")
      .withIndex("by_parent", (q) => q.eq("parentId", args.itemId))
      .collect();
    
    if (childItems.some(child => child._id === args.newParentId)) {
      throw new Error("Cannot create circular dependency");
    }

    // Set the new parent
    await ctx.db.patch(args.itemId, {
      parentId: args.newParentId,
      updatedAt: Date.now(),
    });
  },
});

/** Items and receipts share one reactive snapshot. Seeing a receipt here proves
 * the snapshot includes its write (or a later collaborator edit), so the client
 * can retire exactly that overlay without comparing values or timestamps. */
export const { public: getListItemsForReplay } = actorQuery({
  resources: args => ({ lists: [args.listId] }), scope: "items:read",
  args: { listId: v.id("lists"), operationIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const items = await ctx.db.query("items").withIndex("by_list", q => q.eq("listId", args.listId)).collect();
    const acknowledgments = [];
    if (args.operationIds.length > 128) throw new Error("Too many replay receipts requested");
    for (const operationId of args.operationIds) {
      const receipt = await ctx.db.query("offlineReceipts").withIndex("by_account_operation", q => q.eq("accountId", ctx.actor.userId).eq("operationId", operationId)).unique();
      if (receipt) acknowledgments.push({ operationId, result: receipt.result, revisions: receipt.revisions, ...(receipt.sequence !== undefined ? { sequence: receipt.sequence } : {}) });
    }
    return { items: await withAssignmentsBatch(ctx, items.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt))), acknowledgments, sequence: (await getReplaySequence(ctx, ctx.actor.userId)).sequence };
  },
});

/** Verified identity for a deliberate export of identifiable legacy local work. */
export const { public: getOfflineAccount } = actorQuery({
  resources: () => ({}), scope: "items:read", args: {},
  handler: async ctx => ({ accountId: ctx.actor.turnkeySubOrgId, did: ctx.actor.did, legacyDid: ctx.actor.legacyDid }),
});
