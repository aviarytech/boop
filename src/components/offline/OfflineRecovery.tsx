import { useEffect, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { useAuth } from '../../hooks/useAuth';
import { useOffline } from '../../hooks/useOffline';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { exportSavedEdits, rebaseOperation, resolveOperationId, discardCascade, discardOperation, type OfflineItem, type QueuedMutation } from '../../lib/offline';
import { authErrorData } from '../../../convex/lib/authError';
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
  const [discard, setDiscard] = useState<{ accountId: string; token: string | null | undefined; operationId: string }>();
  const [discarding, setDiscarding] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [review, setReview] = useState<{ accountId: string; mutation: QueuedMutation; items: OfflineItem[] }>();
  const current = useRef({ accountId, token }); current.current = { accountId, token };
  const isCurrent = () => mounted.current && current.current.accountId === accountId && current.current.token === token;
  useEffect(() => { void hasLegacyWork().then(setLegacy); }, []);
  useEffect(() => { setReview(undefined); setDiscard(undefined); setMessage(''); setDiscarding(false); }, [accountId, token]);
  useEffect(() => {
    if (review && operations.find(m => m.operationId === review.mutation.operationId)?.denied) setReview(undefined);
  }, [operations, review]);
  if (!accountId || (!pendingCount && !legacy)) return null;
  const pending = operations.filter(m => m.state !== 'acked');
  const inspect = async (mutation: QueuedMutation) => {
    setReview(undefined); setMessage('');
    try {
      const items = await Promise.all(mutation.expected.map(e => convex.query(api.items.getItemForSync, { itemId: resolveOperationId(e.id, operations) as Id<'items'>, authToken: token ?? undefined })));
      if (isCurrent()) setReview({ accountId, mutation, items });
    } catch (error) { if (isCurrent()) setMessage(authErrorData(error)?.code === 'FORBIDDEN'
      ? 'One or more items were deleted or are no longer available to your account. Export the saved edits, or discard this edit and its dependent edits.'
      : 'Cannot load the current version. The saved edit is still available to export.'); }
  };
  const discardRoot = discard?.accountId === accountId && discard.token === token
    ? operations.find(m => m.operationId === discard.operationId && (m.state === 'conflict' || m.state === 'failed')) : undefined;
  const discardEdits = discardRoot ? discardCascade(operations, discardRoot.operationId) : [];
  const confirmDiscard = async () => {
    if (!isCurrent() || !discardRoot || discarding) return;
    setDiscarding(true);
    try {
      await discardOperation(accountId, discardRoot.operationId, discardEdits.map(m => m.operationId), isCurrent);
      if (isCurrent()) { setDiscard(undefined); setReview(undefined); setMessage('Saved edits discarded from this device.'); }
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : 'Discard failed. Saved edits are still available.');
    } finally { if (isCurrent()) setDiscarding(false); }
  };
  const exportLegacy = async () => {
    try {
      const identity = await convex.query(api.items.getOfflineAccount, { authToken: token ?? undefined });
      if (identity.accountId !== accountId || !isCurrent()) return;
      const edits = await exportIdentifiedLegacyWork(identity);
      if (!isCurrent()) return;
      if (edits.length) download({ notice: 'Review before manually re-entering. Some edits may already have reached the server. Original records remain saved.', edits }, 'boop-legacy-edits.json');
      setMessage(edits.length ? 'Your identifiable legacy edits were exported. Review them against your lists before re-entering them. Originals remain saved.' : 'No legacy edits could be attributed to this account. Try the original account. Unattributed edits remain retained on this device and are not displayed.');
    } catch { if (isCurrent()) setMessage('Connect and sign in to verify ownership before exporting legacy edits.'); }
  };
  return <details className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border bg-white p-3 text-sm text-gray-900 shadow-lg dark:bg-gray-900 dark:text-white">
    <summary className="cursor-pointer">{pendingCount ? `${pendingCount} saved edit(s) awaiting sync` : 'Older offline edits retained'}</summary>
    <div className="max-h-96 overflow-auto space-y-3 pt-3">
      {pendingCount > 0 && <><button className="underline mr-3" onClick={() => void manualSync()}>Retry failed edits</button><button className="underline" onClick={() => download(exportSavedEdits(pending), 'boop-saved-edits.json')}>Export saved edits</button></>}
      {pending.map(m => <div key={m.operationId} className="border-t pt-2">
        <p>{m.type}: {m.legacyRecoveryPending ? 'Older edit retained for recovery' : String(m.payload.name ?? m.payload.itemId ?? 'Selected items')}</p>
        <p>{m.error ?? 'Waiting for sync or a preceding edit'}</p>
        {m.state === 'conflict' && !m.denied && <button className="underline mr-3" onClick={() => void inspect(m)}>Review conflict</button>}
        {(m.state === 'conflict' || m.state === 'failed') && <button className="underline" onClick={() => { setDiscard({ accountId, token, operationId: m.operationId }); setMessage(''); }}>Discard saved edit</button>}
      </div>)}
      {discard?.accountId === accountId && discard.token === token && <div role="alertdialog" aria-labelledby="discard-edits-title" className="border p-2 space-y-2">
        <p id="discard-edits-title">Discard saved edits?</p>
        {discardRoot ? <>
          <p>This permanently removes {discardEdits.length} saved edit(s) from this device: this edit and {discardEdits.length - 1} dependent edit(s). They will not be retried.</p>
          {discardEdits.some(m => m.legacyRecoveryPending) && <p>Some older edits cannot be exported safely. Discarding also permanently removes their retained values.</p>}
          <p>This does not undo edits already sent to the server. A request sent before a connection failure may still finish. Export these edits first if you want to keep a copy.</p>
          <button className="underline mr-3" onClick={() => download(exportSavedEdits(discardEdits), 'boop-discarded-edits-backup.json')}>Export these edits</button>
          <button className="underline mr-3" disabled={discarding} onClick={() => void confirmDiscard()}>Discard edits</button>
        </> : <p>This edit changed or is already syncing. Review the saved edits again before discarding.</p>}
        <button className="underline" disabled={discarding} onClick={() => setDiscard(undefined)}>Cancel discard</button>
      </div>}
      {review?.accountId === accountId && !operations.find(m => m.operationId === review.mutation.operationId)?.denied && <div className="border p-2">
        <p>Current server version</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(review.items.map(i => ({ name: i.name, checked: i.checked, description: i.description })), null, 2)}</pre>
        <p>Your saved edit</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(review.mutation.payload, null, 2)}</pre>
        <button className="underline" onClick={async () => {
          try { if (!isCurrent()) return; await rebaseOperation(accountId, review.mutation.id!, review.items); if (isCurrent()) { setReview(undefined); await manualSync(); } }
          catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : 'Recovery failed'); }
        }}>Apply saved edit to this version</button>
      </div>}
      {legacy && <div className="border-t pt-2"><p>Older offline edits are retained on this device. They have no verified account binding and will not replay automatically.</p><button className="underline" onClick={() => void exportLegacy()}>Export my identifiable legacy edits</button><p>Sign in to the original account to export and manually review its edits. Unattributed entries stay retained and hidden.</p></div>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
