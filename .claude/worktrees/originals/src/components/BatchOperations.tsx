/**
 * Batch operations toolbar for selecting and modifying multiple items.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";
import { useOffline } from "../hooks/useOffline";
import { queueMutation } from "../lib/offline";
import { ConfirmDialog } from "./ConfirmDialog";

interface BatchOperationsProps {
  selectedIds: Set<Id<"items">>;
  onClearSelection: () => void;
  userDid: string;
  legacyDid?: string;
}

export function BatchOperations({
  selectedIds,
  onClearSelection,
  userDid,
  legacyDid,
}: BatchOperationsProps) {
  const { haptic } = useSettings();
  const { isOnline } = useOffline();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const batchCheck = useMutation(api.items.batchCheckItems);
  const batchUncheck = useMutation(api.items.batchUncheckItems);
  const batchDelete = useMutation(api.items.batchDeleteItems);

  const count = selectedIds.size;

  const handleCheckAll = async () => {
    if (isProcessing) return;
    haptic("medium");
    setIsProcessing(true);
    try {
      const payload = {
        itemIds: Array.from(selectedIds),
        checkedByDid: userDid,
        legacyDid,
      };
      
      if (isOnline) {
        await batchCheck(payload);
      } else {
        await queueMutation({
          type: "batchCheckItems",
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
      
      haptic("success");
      onClearSelection();
    } catch (err) {
      console.error("Failed to check items:", err);
      haptic("error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUncheckAll = async () => {
    if (isProcessing) return;
    haptic("medium");
    setIsProcessing(true);
    try {
      const payload = {
        itemIds: Array.from(selectedIds),
        userDid,
        legacyDid,
      };
      
      if (isOnline) {
        await batchUncheck(payload);
      } else {
        await queueMutation({
          type: "batchUncheckItems",
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
      
      haptic("success");
      onClearSelection();
    } catch (err) {
      console.error("Failed to uncheck items:", err);
      haptic("error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAll = async () => {
    if (isProcessing) return;
    haptic("medium");
    setIsProcessing(true);
    try {
      const payload = {
        itemIds: Array.from(selectedIds),
        userDid,
        legacyDid,
      };
      
      if (isOnline) {
        await batchDelete(payload);
      } else {
        await queueMutation({
          type: "batchDeleteItems",
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
      
      haptic("success");
      onClearSelection();
    } catch (err) {
      console.error("Failed to delete items:", err);
      haptic("error");
    } finally {
      setIsProcessing(false);
      setShowDeleteConfirm(false);
    }
  };

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl shadow-2xl animate-slide-up">
        <span className="text-sm font-medium">
          {count} selected
        </span>
        
        <div className="w-px h-6 bg-gray-700 dark:bg-gray-300" />
        
        <button
          onClick={handleCheckAll}
          disabled={isProcessing}
          className="p-2 hover:bg-gray-700 dark:hover:bg-gray-300 rounded-lg transition-colors disabled:opacity-50"
          title="Check all"
          aria-label="Check all selected items"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        
        <button
          onClick={handleUncheckAll}
          disabled={isProcessing}
          className="p-2 hover:bg-gray-700 dark:hover:bg-gray-300 rounded-lg transition-colors disabled:opacity-50"
          title="Uncheck all"
          aria-label="Uncheck all selected items"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <button
          onClick={() => {
            haptic("light");
            setShowDeleteConfirm(true);
          }}
          disabled={isProcessing}
          className="p-2 text-red-400 hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50"
          title="Delete all"
          aria-label="Delete all selected items"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        
        <div className="w-px h-6 bg-gray-700 dark:bg-gray-300" />
        
        <button
          onClick={() => {
            haptic("light");
            onClearSelection();
          }}
          className="p-2 hover:bg-gray-700 dark:hover:bg-gray-300 rounded-lg transition-colors"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Items"
          message={`Are you sure you want to delete ${count} item${count > 1 ? "s" : ""}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteAll}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmVariant="danger"
        />
      )}
    </>
  );
}
