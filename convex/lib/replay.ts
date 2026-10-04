import { withAssignments } from "./assignments";
import { AuthError } from './authError';
import { v, ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { ResolvedActor } from './actor';
import { canonical, revision, replayTargets, type ReplayAck } from '../../shared/replay';

export const replayMetadata = v.object({
  operationId: v.string(), accountId: v.string(),
  expected: v.array(v.object({ id: v.string(), revision: v.string(), predecessor: v.optional(v.string()) })),
});
type Metadata = typeof replayMetadata.type;
const conflict = (message: string) => new ConvexError({ code: 'REPLAY_CONFLICT', message });

/** Isolated counter: advancing replay must not invalidate general auth or
 * permission reads of the user row. Preserve a pre-migration fence without
 * patching that hot row; the first new replay seeds the dedicated counter. */
export async function getReplaySequence(ctx: QueryCtx, accountId: Id<'users'>) {
  const row = await ctx.db.query('replaySequences').withIndex('by_account', q => q.eq('accountId', accountId)).unique();
  return { row, sequence: row?.sequence ?? (await ctx.db.get(accountId))?.replaySequence ?? 0 };
}

/** Called inside the authenticated mutation transaction. Receipts are permanent:
 * deleting one would make an old/lost-response replay unsafe. No signed evidence
 * is replaced or synthesized here; the existing handler executes exactly once. */
export async function replayOperation(
  ctx: MutationCtx, actor: ResolvedActor, operation: string,
  payload: Record<string, unknown>, meta: Metadata, execute: () => Promise<unknown>,
): Promise<ReplayAck> {
  if (meta.accountId !== actor.turnkeySubOrgId) throw new AuthError('Offline account mismatch', 'UNAUTHORIZED');
  if (!meta.operationId || meta.operationId.length > 200) throw new Error('Invalid operation ID');
  const fingerprint = await revision({ operation, payload, expected: meta.expected });
  const receipt = await ctx.db.query('offlineReceipts').withIndex('by_account_operation', q => q.eq('accountId', actor.userId).eq('operationId', meta.operationId)).unique();
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new Error('Operation ID reused with different content');
    return { operationId: receipt.operationId, result: receipt.result, revisions: receipt.revisions, ...(receipt.sequence !== undefined ? { sequence: receipt.sequence } : {}) };
  }
  const targets = replayTargets(operation, payload);
  if (canonical([...targets].sort()) !== canonical(meta.expected.map(e => e.id).sort())) throw conflict('Missing expected revision. Review this saved edit before applying it.');
  for (const expected of meta.expected) {
    let wanted = expected.revision;
    if (expected.predecessor) {
      const prior = await ctx.db.query('offlineReceipts').withIndex('by_account_operation', q => q.eq('accountId', actor.userId).eq('operationId', expected.predecessor!)).unique();
      if (!prior || !prior.revisions[expected.id]) throw conflict('A preceding local edit has not been acknowledged.');
      wanted = prior.revisions[expected.id];
    }
    const doc = await ctx.db.get(expected.id as Id<'items'>);
    if (!doc) throw conflict('This item changed on the server. Your edit is saved for review.');
    const rawMatches = await revision(doc) === wanted;
    // Already-open older clients hash the new joined read response verbatim.
    // Accept exactly our current server projection as well as the persisted
    // document, never arbitrary client-selected fields. Membership changes still
    // alter assignmentsVersion (and the projection), so both forms conflict.
    const projectedMatches = !rawMatches && 'listId' in doc && 'checked' in doc
      && await revision(await withAssignments(ctx, doc)) === wanted;
    if (!rawMatches && !projectedMatches) throw conflict('This item changed on the server. Your edit is saved for review.');
  }
  const result = await execute() ?? null;
  const revisions: Record<string, string> = {};
  for (const id of targets) revisions[id] = await revision(await ctx.db.get(id as Id<'items'>));
  if ((operation === 'addItem' || operation === 'createList') && typeof result === 'string') {
    revisions[result] = await revision(await ctx.db.get(result as Id<'items'>));
  }
  const counter = await getReplaySequence(ctx, actor.userId);
  const sequence = counter.sequence + 1;
  if (counter.row) await ctx.db.patch(counter.row._id, { sequence });
  else await ctx.db.insert('replaySequences', { accountId: actor.userId, sequence });
  await ctx.db.insert('offlineReceipts', { sequence, accountId: actor.userId, operationId: meta.operationId, fingerprint, result, revisions });
  return { operationId: meta.operationId, result, revisions, sequence };
}
