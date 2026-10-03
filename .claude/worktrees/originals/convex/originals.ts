/**
 * Originals Explorer — unified read-only query.
 *
 * Joins lists, sites, siteHostnames, publications, bitcoinAnchors, activities,
 * itemAssignees into a single ExplorerRow[] sorted by updatedAt desc with
 * id-ascending tiebreaker. Pure derivation logic lives in src/lib/explorer.ts.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  deriveExplorerRows,
  type DeriveInput,
  type ExplorerRow,
} from "../src/lib/explorer";

export const listOwnedOriginals = query({
  args: { ownerDid: v.string() },
  handler: async (ctx, args): Promise<ExplorerRow[]> => {
    const [lists, sites] = await Promise.all([
      ctx.db
        .query("lists")
        .withIndex("by_owner", (q) => q.eq("ownerDid", args.ownerDid))
        .collect(),
      ctx.db
        .query("sites")
        .withIndex("by_owner", (q) => q.eq("ownerDid", args.ownerDid))
        .collect(),
    ]);

    // Per-site joins: hostnames.
    const hostnamesBySite = new Map<string, Doc<"siteHostnames">[]>();
    await Promise.all(
      sites.map(async (site) => {
        const hostnames = await ctx.db
          .query("siteHostnames")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .collect();
        hostnamesBySite.set(site._id, hostnames);
      }),
    );

    // Per-list joins: publication, anchors, latest activity, assignee count.
    const publicationsByList = new Map<string, Doc<"publications">>();
    const anchorsByList = new Map<string, Doc<"bitcoinAnchors">[]>();
    const activitiesByList = new Map<string, { createdAt: number }>();
    const assigneesByList = new Map<string, number>();

    await Promise.all(
      lists.map(async (list) => {
        const [pub, anchors, latestActivity, assignees] = await Promise.all([
          ctx.db
            .query("publications")
            .withIndex("by_list", (q) => q.eq("listId", list._id))
            .first(),
          ctx.db
            .query("bitcoinAnchors")
            .withIndex("by_list", (q) => q.eq("listId", list._id))
            .collect(),
          ctx.db
            .query("activities")
            .withIndex("by_list_created", (q) => q.eq("listId", list._id))
            .order("desc")
            .first(),
          ctx.db
            .query("itemAssignees")
            .withIndex("by_list", (q) => q.eq("listId", list._id))
            .collect(),
        ]);

        if (pub) publicationsByList.set(list._id, pub);
        if (anchors.length > 0) anchorsByList.set(list._id, anchors);
        if (latestActivity) activitiesByList.set(list._id, { createdAt: latestActivity.createdAt });

        const uniqueAssignees = new Set<string>();
        for (const a of assignees) uniqueAssignees.add(a.assigneeDid);
        if (uniqueAssignees.size > 0) assigneesByList.set(list._id, uniqueAssignees.size);
      }),
    );

    const input: DeriveInput = {
      lists: lists.map((l) => ({
        _id: l._id,
        _creationTime: l._creationTime,
        name: l.name,
        ownerDid: l.ownerDid,
        assetDid: l.assetDid,
      })),
      sites: sites.map((s) => ({
        _id: s._id,
        _creationTime: s._creationTime,
        ownerDid: s.ownerDid,
        primaryHostnameId: s.primaryHostnameId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        did: s.did,
      })),
      hostnamesBySite,
      publicationsByList,
      anchorsByList,
      activitiesByList,
      assigneesByList,
    };

    return deriveExplorerRows(input);
  },
});
