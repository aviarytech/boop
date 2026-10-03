import { canonical } from '../../shared/replay';
import { EMPTY_OFFLINE_STATE, getOfflineState, subscribeOffline, type OfflineState } from './offline';

// One IDB read, comparison, and polling timer per mounted account, shared by
// list rows, modals, recovery UI, and list hooks. No provider placement required.
const accounts = new Map<string, ReturnType<typeof createObserver>>();
function createObserver(accountId: string) {
  let snapshot: OfflineState = EMPTY_OFFLINE_STATE;
  let fingerprint = canonical(snapshot);
  const listeners = new Map<() => void, { sync: () => void; session?: { token: string; isCurrent: () => boolean } }>();
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let reading = false;
  let dirty = false;
  const refresh = async () => {
    dirty = true;
    if (reading) return;
    reading = true;
    try {
      while (dirty && listeners.size) {
        dirty = false;
        const next = await getOfflineState(accountId);
        const nextFingerprint = canonical(next);
        if (nextFingerprint !== fingerprint) {
          snapshot = next;
          fingerprint = nextFingerprint;
          listeners.forEach((_, listener) => listener());
        }
      }
    } finally { reading = false; }
  };
  return {
    getSnapshot: () => snapshot,
    // Sync belongs to the account/session, not whichever row started it. A
    // removed row can hand the drain to a still-mounted list using that session.
    hasSession(token: string) {
      return [...listeners.values()].some(({ session }) => session?.token === token && session.isCurrent());
    },
    subscribe(listener: () => void, sync: () => void, session?: { token: string; isCurrent: () => boolean }) {
      listeners.set(listener, { sync, session });
      if (listeners.size === 1) {
        unsubscribe = subscribeOffline(() => void refresh());
        timer = setInterval(() => {
          void refresh();
          // Any mounted subscriber for this account can supply the session.
          [...listeners.values()].at(-1)?.sync();
        }, 5000);
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribe?.(); clearInterval(timer); }
      };
    },
  };
}
export function offlineObserver(accountId: string) {
  let observer = accounts.get(accountId);
  if (!observer) { observer = createObserver(accountId); accounts.set(accountId, observer); }
  return observer;
}
