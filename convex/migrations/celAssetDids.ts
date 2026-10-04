"use node";

/**
 * One-shot migration: re-mint legacy `did:peer:*` list assetDids as `did:cel:*`.
 *
 * Run after deploying this branch:
 *   npx convex run migrations/celAssetDids:runAll
 *   npx convex run --prod migrations/celAssetDids:runAll
 *
 * Two kinds of rows are rewritten, both matched by the `did:peer:` prefix:
 *  - genuine did:peer DIDs minted by @originals/sdk 1.x, before 2.0.0 dropped
 *    did:peer as a genesis layer;
 *  - `did:peer:temp-<ms>` placeholders that createListFromTemplate inserted with
 *    a "will be replaced with proper DID" comment. It never replaced them, so
 *    every list made from a *saved* template carries a DID that was never real.
 *
 * Genesis is minted server-side here, with a temporary local signer —
 * no key is retained. That is
 * deliberate: the genesis controller key would otherwise be held by the server
 * rather than the owner, which is a custody change this migration has no mandate
 * to make. The consequence is that migrated lists are VERIFIABLE (the envelope
 * carries the signed CEL log) but not AUTHORABLE — later CEL appends degrade to
 * cel:append-skipped, since no one holds the key. Lists created after this branch
 * ships keep their key client-side and are both. Making a migrated list authorable
 * requires re-genesis by its owner, which only the owner's browser can do.
 *
 * Idempotent — rows already on a non-did:peer DID are skipped, so a re-run after
 * a partial failure only touches what is left.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { OriginalsSDK } from "@originals/sdk";
import { createLocalSigner } from "@originals/sdk/v3";

/**
 * Mint a did:cel for an existing list, using the same genesis resource shape as
 * buildListResource in src/lib/originals.ts so migrated and new lists agree.
 */
export async function mintCelGenesis(
  name: string,
  ownerDid: string,
  createdAt: number
): Promise<{ assetDid: string; envelope: string }> {
  const content = JSON.stringify({
    name,
    createdBy: ownerDid,
    createdAt: new Date(createdAt).toISOString(),
  });
  // Explicit temporary custody: retain the signed archive, discard the controller key.
  const signer = createLocalSigner("Ed25519", crypto.getRandomValues(new Uint8Array(32)));
  const sdk = OriginalsSDK.create({ signer });
  const asset = await sdk.lifecycle.createAsset([
    { id: "list-metadata", mediaType: "application/json", content },
  ]);
  return { assetDid: asset.id, envelope: JSON.stringify(asset.serialize()) };
}

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ migrated: number; skipped: number }> => {
    const rows: Array<{
      _id: Id<"lists">;
      assetDid: string;
      name: string;
      ownerDid: string;
      createdAt: number;
    }> = await ctx.runQuery(internal.migrations.celAssetDidsDb.listLegacyLists, {});

    let migrated = 0;
    let skipped = 0;
    for (const row of rows) {
      const { assetDid, envelope } = await mintCelGenesis(
        row.name,
        row.ownerDid,
        row.createdAt
      );
      const result: { migrated: boolean } = await ctx.runMutation(
        internal.migrations.celAssetDidsDb.setListAssetDid,
        { listId: row._id, assetDid, celEnvelope: envelope }
      );
      if (result.migrated) {
        console.log(`[celAssetDids] ${row._id}: ${row.assetDid} -> ${assetDid}`);
        migrated += 1;
      } else {
        skipped += 1;
      }
    }

    console.log(
      `[celAssetDids] complete — ${migrated} migrated, ${skipped} skipped of ${rows.length} candidates`
    );
    return { migrated, skipped };
  },
});
