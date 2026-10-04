import { purgeAppDownloadCaches } from '../../lib/downloadCache';
import { useEffect, useMemo, useReducer } from 'react';
import { useOffline } from '../../hooks/useOffline';
import { useQueries } from 'convex/react';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { reconcileOfflineAccess } from '../../lib/offline';
import { draftResources, reconcileDraftAccess, subscribeDrafts } from '../../lib/noteDrafts';

type ItemLocator = { itemId: Id<'items'>; listId: Id<'lists'> };
const noItems: ItemLocator[] = [];
function AccessBatch({ accountId, listIds, items = noItems }: { accountId: string; listIds: Id<'lists'>[]; items?: ItemLocator[] }) {
  const { token } = useAuth();
  // Errors are values: session expiry must not unmount independent recovery.
  const queries = useMemo((): Parameters<typeof useQueries>[0] => token ? { access: { query: api.items.getOfflineAccess, args: { listIds, items, authToken: token } } } : {}, [token, listIds, items]);
  const { access } = useQueries(queries);
  useEffect(() => {
    if (access && !(access instanceof Error)) void reconcileOfflineAccess(accountId, access);
  }, [accountId, access]);
  return null;
}
function DraftBatch({ resources }: { resources: ReturnType<typeof draftResources> }) {
  const { token } = useAuth();
  const queries = useMemo((): Parameters<typeof useQueries>[0] => token ? { access: { query: api.items.getOfflineDraftAccess, args: { resources: resources.map(({ kind, id }) => ({ kind, id })), authToken: token } } } : {}, [token, resources]);
  const { access } = useQueries(queries);
  const keys = JSON.stringify(resources);
  useEffect(() => {
    if (!access || access instanceof Error) return;
    const entries: ReturnType<typeof draftResources> = JSON.parse(keys);
    for (const entry of access) for (const resource of entries) if (resource.kind === entry.kind && resource.id === entry.id) {
      reconcileDraftAccess(resource.documentKey, entry.canEdit, entry.checkedAt);
    }
  }, [access, keys]);
  return null;
}
const batches = <T,>(entries: T[]) => Array.from({ length: Math.ceil(entries.length / 128) }, (_, index) => entries.slice(index * 128, (index + 1) * 128));
/** Outside the route boundary: unopened resources and source comparison caches
 * still reconcile when a content subscription is denied and its view unmounts. */
export function OfflineAccessMonitor() {
  const { accountId, compaction, isOnline } = useOffline();
  const { token } = useAuth();
  // Convex useQueries requires stable request identity, including when signed out.
  const queries = useMemo((): Parameters<typeof useQueries>[0] => token ? { identity: { query: api.items.getOfflineAccount, args: { authToken: token } } } : {}, [token]);
  const { identity } = useQueries(queries);
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => subscribeDrafts(refresh), []);
  const revokedKey = [...compaction.revokedListIds ?? []].sort().join(',');
  useEffect(() => { void purgeAppDownloadCaches().catch(() => undefined); }, [accountId, isOnline, revokedKey]);
  const ids = [...new Set([
    ...(compaction.lists ?? []).map(list => list._id), ...compaction.items.map(item => item.listId),
    ...compaction.operations.flatMap(m => m.listIds), ...compaction.revokedListIds ?? [],
  ])].filter(id => !id.startsWith('temp-')).sort() as Id<'lists'>[];
  const items = compaction.items.filter(item => !item._id.startsWith('temp-')).map(item => ({ itemId: item._id, listId: item.listId }));
  const resources = identity && !(identity instanceof Error) && identity.accountId === accountId
    ? draftResources([identity.did, identity.legacyDid].filter((did): did is string => typeof did === 'string')) : [];
  return <>{accountId && <>
    {batches(ids).map((listIds, index) => <AccessBatch key={`${accountId}:list:${index}`} accountId={accountId} listIds={listIds} />)}
    {batches(items).map((items, index) => <AccessBatch key={`${accountId}:item:${index}`} accountId={accountId} listIds={[]} items={items} />)}
    {batches(resources).map((resources, index) => <DraftBatch key={`${accountId}:draft:${index}`} resources={resources} />)}
  </>}</>;
}
