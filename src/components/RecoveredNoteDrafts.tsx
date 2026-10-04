import { useState } from "react";
import { clearDraft, listDrafts, type StoredDraft } from "../lib/noteDrafts";

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

/** Recovery is independent of source access: only this account's local text.
 * Never show the stored base or fetch the resource to export an unsent draft. */
export function UnsentNoteDrafts({ documentKey, aliases = [], onDiscard }: {
  documentKey?: string; aliases?: readonly string[]; onDiscard?: (draft: StoredDraft) => void;
}) {
  const [, refresh] = useState(0);
  const drafts = documentKey ? listDrafts(documentKey, aliases) : [];
  if (!drafts.length) return null;
  return (
    <section className="my-4 rounded-xl border border-amber-400 p-4 text-sm text-left">
      <p>Editing is unavailable. Your unsent drafts are kept on this device. Copy or download them to keep an independent version.</p>
      {drafts.map(draft => (
        <div key={draft.key}>
          <textarea aria-label="Unsent local draft" readOnly value={draft.text}
            className="mt-3 min-h-40 w-full bg-transparent font-mono" />
          <button type="button" className="underline" onClick={() => {
            const url = URL.createObjectURL(new Blob([draft.text], { type: "text/plain;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "unsent-note.txt";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
          }}>Download draft</button>
          <button type="button" className="ml-4 underline" onClick={() => {
            // A different tab may have revised this record since it was rendered.
            if (clearDraft(draft.key, draft.record)) onDiscard?.(draft);
            refresh(revision => revision + 1);
          }}>Discard draft</button>
        </div>
      ))}
    </section>
  );
}
