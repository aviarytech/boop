import { RecoveredNoteDrafts, UnsentNoteDrafts } from "../components/RecoveredNoteDrafts";
import { NoteConflict } from "../components/NoteConflict";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "../lib/authenticatedConvex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { useAutosaveDraft } from "../hooks/useAutosaveDraft";
import { MAX_NOTE_LENGTH } from "../lib/noteEditor";

export function NoteEditor() {
  const { itemId } = useParams<{ itemId: string }>();
  const { did } = useCurrentUser();
  return <ItemNoteEditor key={`${did}:${itemId}`} />;
}

function ItemNoteEditor() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { haptic } = useSettings();
  const goBack = () => {
    haptic("light");
    if (window.history.length > 1) navigate(-1);
    else navigate("/d");
  };
  const { did } = useCurrentUser();

  const data = useQuery(
    api.items.getItemForEditor,
    itemId && did
      ? { itemId: itemId as Id<"items"> }
      : "skip"
  );
  const updateItem = useMutation(api.items.updateItem);

  const draftKey = did && itemId ? `${did}:item:${itemId}` : undefined;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const { value, onChange, status, retry, useServer, saveDraft, dirty, otherDrafts, recoverDraft } = useAutosaveDraft({
    saved: data?.description,
    draftKey,
    canEdit: !!data?.canEdit,
    persist: async (text, expectedBody) => {
      await updateItem({ itemId: itemId as Id<"items">, description: text, expectedDescription: expectedBody });
    },
  });

  // --- Loading
  if (data === undefined) {
    return (
      <div className="min-h-screen-safe bg-stone-50 dark:bg-gray-950 p-4">
        <div className="animate-pulse h-8 w-40 bg-stone-200 dark:bg-gray-800 rounded mb-4" />
        <div className="animate-pulse h-64 w-full bg-stone-200 dark:bg-gray-800 rounded" />
      </div>
    );
  }

  // --- Not available
  if (data === null || status === "denied") {
    return (
      <div className="min-h-screen-safe bg-stone-50 dark:bg-gray-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-stone-600 dark:text-stone-400">This note isn't available.</p>
        <UnsentNoteDrafts documentKey={draftKey} />
        <button
          onClick={goBack}
          className="rounded-full px-4 py-2 text-sm font-semibold bg-amber-500 text-white"
        >
          Go back
        </button>
      </div>
    );
  }

  const editingUnavailable = !data.canEdit;
  const displayBody = editingUnavailable ? data.description : value;
  const nearLimit = value.length > MAX_NOTE_LENGTH - 500;
  const statusLabel = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";

  // --- Editor
  return (
    <div className="min-h-screen-safe flex flex-col bg-stone-50 dark:bg-gray-950">
      <header className="flex-shrink-0 sticky top-0 z-10 bg-stone-50/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-stone-200 dark:border-gray-800 safe-area-inset-top">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={goBack}
            aria-label="Back"
            className="text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
          >
            ‹ Back
          </button>
          <h1 className="flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
            {data.name}
          </h1>
          <span className="text-xs text-stone-400 text-right" aria-live="polite">
            {status === "error" ? (
              <span role="alert" className="text-red-600 dark:text-red-400">
                Not saved to server. Draft kept on this device.{' '}
                <button type="button" onClick={retry} className="underline">Retry</button>
              </span>
            ) : statusLabel}
          </span>
          <button
            onClick={() => { haptic("light"); setMode((mode) => (mode === "edit" ? "preview" : "edit")); }}
            aria-pressed={mode === "preview"}
            className="rounded-full px-3 py-1.5 text-xs font-semibold bg-stone-100 dark:bg-gray-900 text-stone-700 dark:text-stone-200"
          >
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
        </div>
      </header>
      {editingUnavailable
        ? <UnsentNoteDrafts documentKey={draftKey} />
        : <RecoveredNoteDrafts drafts={otherDrafts} disabled={dirty} onRecover={recoverDraft} />}
      {!editingUnavailable && status === "conflict" && <NoteConflict serverBody={data.description} onUseServer={useServer} onSaveDraft={saveDraft} />}

      <main className="flex-1 flex flex-col px-4 py-3 safe-area-inset-bottom">
        {mode === "edit" && !editingUnavailable ? (
          <textarea
            value={value}
            aria-label="Note body"
            onChange={(e) => onChange(e.target.value)}
            autoFocus
            placeholder="Start writing…  (markdown supported)"
            className="flex-1 w-full resize-none bg-transparent text-base leading-relaxed text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none font-mono"
          />
        ) : (
          <div className="flex-1 w-full prose prose-stone dark:prose-invert max-w-none overflow-auto">
            {displayBody.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayBody}</ReactMarkdown>
            ) : (
              <p className="text-stone-400">Nothing to preview yet.</p>
            )}
          </div>
        )}
        {nearLimit && (
          <p className="flex-shrink-0 pt-2 text-xs text-stone-400 text-right">
            {value.length} / {MAX_NOTE_LENGTH}
          </p>
        )}
      </main>
    </div>
  );
}
