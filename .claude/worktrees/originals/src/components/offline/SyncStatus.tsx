/**
 * Sync status display component (Phase 5.6)
 *
 * Shows detailed sync status with visual indicator and manual sync button.
 * Suitable for settings pages or debug displays.
 */

import { useOffline } from "../../hooks/useOffline";

/**
 * Detailed sync status component showing:
 * - Connection status (online/offline) with colored indicator dot
 * - Pending mutation count
 * - Manual sync button (when online with pending changes)
 *
 * @example
 * ```tsx
 * // In a settings page or footer
 * <SyncStatus />
 * ```
 */
export function SyncStatus() {
  const { isOnline, syncStatus, pendingCount, manualSync } = useOffline();

  const isSyncing = syncStatus.status === "syncing";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm"
    >
      {/* Connection indicator dot */}
      <span
        className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`}
        aria-hidden="true"
      />
      <span>{isOnline ? "Online" : "Offline"}</span>

      {/* Pending changes section */}
      {pendingCount > 0 && (
        <>
          <span className="text-gray-400" aria-hidden="true">
            |
          </span>
          <span>
            {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}
          </span>

          {/* Manual sync button - only shown when online */}
          {isOnline && (
            <button
              type="button"
              onClick={manualSync}
              disabled={isSyncing}
              className="text-blue-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? "Syncing..." : "Sync now"}
            </button>
          )}
        </>
      )}

      {/* Error status */}
      {syncStatus.status === "error" && syncStatus.message && (
        <>
          <span className="text-gray-400" aria-hidden="true">
            |
          </span>
          <span className="text-red-600" title={syncStatus.message}>
            Sync error
          </span>
        </>
      )}
    </div>
  );
}
