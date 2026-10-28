/**
 * Blocks a legacy list until its owner re-mints it.
 *
 * Originals 5 reads nothing written under CEL, so a list made before it has no
 * history the app can verify or extend. Re-minting signs a new genesis from the
 * list's current state — the items stay as they are, the list gets a new DID,
 * and the old history is not carried over. There is no "later": leaving goes
 * back to the lists.
 */

import { useNavigate } from "react-router-dom";
import { Panel } from "./ui/Panel";
import type { ListOriginalState } from "../hooks/useListOriginal";

export function RemintListModal({
  kind,
  state,
  error,
  onRemint,
}: {
  kind: "list" | "note";
  state: ListOriginalState;
  error: string | null;
  onRemint: () => void;
}) {
  const navigate = useNavigate();
  const leave = () => navigate("/d");
  const busy = state === "minting";
  const unauthorable = state === "unauthorable";

  return (
    <Panel
      isOpen
      onClose={leave}
      title={`Re-mint this ${kind}`}
      footer={
        <div className="flex gap-3">
          <button
            onClick={leave}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium disabled:opacity-50"
          >
            Back to lists
          </button>
          {!unauthorable && (
            <button
              onClick={onRemint}
              disabled={busy}
              className="flex-1 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold disabled:opacity-50"
            >
              {busy ? "Re-minting…" : `Re-mint ${kind}`}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          This {kind} was made with an older version of Originals, and its history can't be read
          any more. Re-minting gives it a new signed identity from what it holds now.
        </p>
        <p>
          Everything in it stays as it is, and so do its links. Its old history isn't carried over.
        </p>
        {unauthorable && (
          <p className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300">
            This device can't sign for you yet, so it can't re-mint the {kind}. Open it on a device
            that can.
          </p>
        )}
        {error && (
          <p className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
