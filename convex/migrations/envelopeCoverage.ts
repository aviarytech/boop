/**
 * Diagnostic: how many lists have a stored CEL envelope, and how many don't.
 *
 * A list with no `listEnvelopes` row has nothing to verify, and the provenance
 * UI renders nothing for it — so this is the population the "copy to a new list"
 * flow exists to serve.
 *
 *   npx convex run migrations/envelopeCoverage:count
 *   npx convex run --prod migrations/envelopeCoverage:count
 *
 * Read-only. Both tables are scanned in full, so `truncated` reports whether the
 * numbers are complete rather than letting a read limit look like a real answer.
 */

import { internalQuery } from "../_generated/server";

const SCAN_LIMIT = 8000;

export const count = internalQuery({
  args: {},
  handler: async (ctx) => {
    const lists = await ctx.db.query("lists").take(SCAN_LIMIT);
    const envelopes = await ctx.db.query("listEnvelopes").take(SCAN_LIMIT);

    const envelopeFor = new Map(envelopes.map((e) => [e.listId, e]));
    const missing = lists.filter((l) => !envelopeFor.has(l._id));

    // A genesis proof signed well after the list already existed is one the
    // celAssetDids migration minted, with an ephemeral controller — verifiable,
    // but nobody holds its key, so it can never author another event. Mirrors
    // isRetroactiveGenesis in src/lib/originals.ts.
    let retroactive = 0;
    for (const list of lists) {
      const row = envelopeFor.get(list._id);
      if (!row) continue;
      try {
        const proof = JSON.parse(row.envelope)?.eventLog?.events?.[0]?.proof;
        const created = (Array.isArray(proof) ? proof[0] : proof)?.created;
        const sealedAt = created ? Date.parse(created) : NaN;
        if (!Number.isNaN(sealedAt) && sealedAt - list.createdAt > 60_000) retroactive += 1;
      } catch {
        // An unparseable envelope is a verification problem, not a custody one.
      }
    }

    // Grouped by DID scheme: a did:peer row means the earlier celAssetDids
    // migration never ran on it, which is a different fix from a missing envelope.
    const byScheme: Record<string, number> = {};
    for (const l of missing) {
      const scheme = l.assetDid?.split(":").slice(0, 2).join(":") ?? "(none)";
      byScheme[scheme] = (byScheme[scheme] ?? 0) + 1;
    }

    return {
      lists: lists.length,
      withEnvelope: lists.length - missing.length,
      missingEnvelope: missing.length,
      missingByDidScheme: byScheme,
      // The population the "make an authorable copy" action exists to serve.
      retroactiveGenesis: retroactive,
      authorable: lists.length - missing.length - retroactive,
      truncated: lists.length === SCAN_LIMIT || envelopes.length === SCAN_LIMIT,
    };
  },
});
