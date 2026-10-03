import { useEffect, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { useAuth } from '../../hooks/useAuth';
import { useOffline } from '../../hooks/useOffline';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { rebaseOperation, resolveOperationId, type OfflineItem, type QueuedMutation } from '../../lib/offline';
import { exportIdentifiedLegacyWork, hasLegacyWork } from '../../lib/legacyOffline';
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OfflineRecovery() {
  const { accountId, operations, manualSync, pendingCount } = useOffline();
  const { token } = useAuth();
  const convex = useConvex();
  const [legacy, setLegacy] = useState(false);
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<{ accountId: string; mutation: QueuedMutation; items: OfflineItem[] }>();
  const current = useRef(accountId); current.current = accountId;
  useEffect(() => { void hasLegacyWork().then(setLegacy); }, []);
  useEffect(() => { setReview(undefined); setMessage(''); }, [accountId]);
  if (!accountId || (!pendingCount && !legacy)) return null;
  const pending = operations.filter(m => m.state !== 'acked');
  const inspect = async (mutation: QueuedMutation) => {
    try {
      const items = await Promise.all(mutation.expected.map(e => convex.query(api.items.getItemForSync, { itemId: resolveOperationId(e.id, operations) as Id<'items'>, authToken: token ?? undefined })));
      if (current.current === accountId) setReview({ accountId, mutation, items });
    } catch { if (current.current === accountId) setMessage('Cannot load the current version. The saved edit is still available to export.'); }
  };
  const exportLegacy = async () => {
    try {
      const identity = await convex.query(api.items.getOfflineAccount, { authToken: token ?? undefined });
      if (identity.accountId !== accountId || current.current !== accountId) return;
      const edits = await exportIdentifiedLegacyWork(identity);
      if (current.current !== accountId) return;
      if (edits.length) download({ notice: 'Review before manually re-entering. Some edits may already have reached the server. Original records remain saved.', edits }, 'boop-legacy-edits.json');
      setMessage(edits.length ? 'Your identifiable legacy edits were exported. Review them against your lists before re-entering them. Originals remain saved.' : 'No legacy edits could be attributed to this account. Try the original account. Unattributed edits remain retained on this device and are not displayed.');
    } catch { if (current.current === accountId) setMessage('Connect and sign in to verify ownership before exporting legacy edits.'); }
  };
  return <details className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border bg-white p-3 text-sm text-gray-900 shadow-lg dark:bg-gray-900 dark:text-white">
    <summary className="cursor-pointer">{pendingCount ? `${pendingCount} saved edit(s) awaiting sync` : 'Older offline edits retained'}</summary>
    <div className="max-h-96 overflow-auto space-y-3 pt-3">
      {pendingCount > 0 && <><button className="underline mr-3" onClick={() => void manualSync()}>Retry failed edits</button><button className="underline" onClick={() => download(pending, 'boop-saved-edits.json')}>Export saved edits</button></>}
      {pending.map(m => <div key={m.operationId} className="border-t pt-2">
        <p>{m.type}: {String(m.payload.name ?? m.payload.itemId ?? 'Selected items')}</p>
        <p>{m.error ?? 'Waiting for sync or a preceding edit'}</p>
        {m.state === 'conflict' && <button className="underline" onClick={() => void inspect(m)}>Review conflict</button>}
      </div>)}
      {review?.accountId === accountId && <div className="border p-2">
        <p>Current server version</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(review.items.map(i => ({ name: i.name, checked: i.checked, description: i.description })), null, 2)}</pre>
        <p>Your saved edit</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(review.mutation.payload, null, 2)}</pre>
        <button className="underline" onClick={async () => {
          try { await rebaseOperation(accountId, review.mutation.id!, review.items); setReview(undefined); await manualSync(); }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery failed'); }
        }}>Apply saved edit to this version</button>
      </div>}
      {legacy && <div className="border-t pt-2"><p>Older offline edits are retained on this device. They have no verified account binding and will not replay automatically.</p><button className="underline" onClick={() => void exportLegacy()}>Export my identifiable legacy edits</button><p>Sign in to the original account to export and manually review its edits. Unattributed entries stay retained and hidden.</p></div>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
