import type { StoredDraft } from "../lib/noteDrafts";

export function RecoveredNoteDrafts({ drafts, disabled, onRecover }: {
  drafts: StoredDraft[]; disabled: boolean; onRecover: (draft: StoredDraft) => void;
}) {
  if (!drafts.length) return null;
  return (
    <details className="my-4 rounded-xl border border-amber-400 p-4 text-sm">
      <summary>Other drafts on this device ({drafts.length})</summary>
      {disabled && <p>Save or resolve the current draft before restoring another.</p>}
      {drafts.map(draft => (
        <div key={draft.key} className="mt-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{draft.text || "(Empty note)"}</pre>
          <button type="button" disabled={disabled} className="underline disabled:opacity-50" onClick={() => onRecover(draft)}>Restore this draft</button>
        </div>
      ))}
    </details>
  );
}
