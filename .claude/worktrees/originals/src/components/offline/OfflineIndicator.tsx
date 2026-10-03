/**
 * Shows a banner when the app is offline.
 * Features improved design, dark mode support, and sync status.
 * Tuned for Capacitor native shell with proper safe area insets.
 */

import { useEffect, useRef } from 'react';
import { useOffline } from '../../hooks/useOffline';

export function OfflineIndicator() {
  const { isOnline, syncStatus, pendingCount } = useOffline();
  const wasOffline = useRef(false);
  const showReconnected = useRef(false);

  // Track reconnection to show brief "back online" message
  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      showReconnected.current = false;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      showReconnected.current = true;
      const timer = setTimeout(() => {
        showReconnected.current = false;
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  // Show syncing state after reconnection
  if (isOnline && syncStatus.status === 'syncing') {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 safe-area-top">
        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-4 py-2.5 text-center text-sm font-medium shadow-lg">
          <div className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Syncing {pendingCount} change{pendingCount !== 1 ? 's' : ''}...</span>
          </div>
        </div>
      </div>
    );
  }

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 safe-area-top" role="alert" aria-live="assertive">
      <div className="bg-amber-500 text-white px-4 py-2.5 text-center text-sm font-medium shadow-lg">
        <div className="flex items-center justify-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
          </span>
          <span>
            You're offline
            {pendingCount > 0
              ? ` — ${pendingCount} change${pendingCount !== 1 ? 's' : ''} queued`
              : ' — changes will sync when reconnected'}
          </span>
        </div>
      </div>
    </div>
  );
}
