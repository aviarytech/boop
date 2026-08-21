/**
 * One-shot: fill listEnvelopes.genesisSealedAt on rows written before the
 * field existed.
 *
 *   npx convex run migrations/backfillGenesisSealedAt:runAll
 *   npx convex run --prod migrations/backfillGenesisSealedAt:runAll
 *
 * Idempotent — rows that already have the field are skipped, so a re-run after
 * a partial failure only touches what is left. Parsing the envelope here is the
 * expensive path this field exists to avoid on every list-index render.
 */

import { internalMutation } from "../_generated/server";
import { genesisSealedAt } from "../lib/legacyList";

export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("listEnvelopes").collect();

    let filled = 0;
    let skipped = 0;
    let unreadable = 0;

    for (const row of rows) {
      if (row.genesisSealedAt !== undefined) {
        skipped += 1;
        continue;
      }
      const sealedAt = genesisSealedAt(row.envelope);
      if (sealedAt === null) {
        // A log we cannot read is a verification problem, not a legacy one —
        // leave it unset so the UI treats it as "unknown" rather than legacy.
        unreadable += 1;
        continue;
      }
      await ctx.db.patch(row._id, { genesisSealedAt: sealedAt });
      filled += 1;
    }

    console.log(
      `[backfillGenesisSealedAt] ${filled} filled, ${skipped} already set, ${unreadable} unreadable of ${rows.length}`
    );
    return { total: rows.length, filled, skipped, unreadable };
  },
});
