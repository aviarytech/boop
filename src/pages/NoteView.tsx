import { useCurrentUser } from "../hooks/useCurrentUser";
import { RecoveredNoteDrafts, UnsentNoteDrafts } from "../components/RecoveredNoteDrafts";
import { NoteConflict } from "../components/NoteConflict";
/**
 * A note's page: the list header's layout with an Edit/Preview toggle where
 * the list's view pill sits, over a markdown body that autosaves.
 */

import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMutation, useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isNote, wordCount } from "../../convex/lib/noteBody";
import { useAutosaveDraft } from "../hooks/useAutosaveDraft";
import { useCategories } from "../hooks/useCategories";
import { useOffline } from "../hooks/useOffline";
import { useSettings } from "../hooks/useSettings";
import { HeaderActionsMenu } from "../components/HeaderActionsMenu";
import { ListVerificationBadge } from "../components/VerificationBadge";
import { MAX_NOTE_LENGTH } from "../lib/noteEditor";
import { shortRelativeTime } from "../lib/format";

const DeleteListDialog = lazy(() => import("../components/DeleteListDialog").then(m => ({ default: m.DeleteListDialog })));
const RenameListDialog = lazy(() => import("../components/RenameListDialog").then(m => ({ default: m.RenameListDialog })));
const ChangeCategoryDialog = lazy(() => import("../components/ChangeCategoryDialog").then(m => ({ default: m.ChangeCategoryDialog })));

const MONO = 'Geist Mono, ui-monospace, monospace';

type Mode = "edit" | "preview";
type NoteBody = { body: string; updatedAt: number; canEdit: boolean; accessCheckedAt: number };

export function NoteView() {
  const { id } = useParams<{ id: string }>();
  const listId = id as Id<"lists">;
  const { did, legacyDid, isLoading: identityLoading } = useCurrentUser();
  const draftKey = did && id ? `${did}:note:${id}` : undefined;
  // Only server-verified aliases of this account can recover pre-upgrade drafts.
  // This also works after source access is lost; the owner is not consulted.
  const draftAliases = did && legacyDid && id && legacyDid !== did ? [`${legacyDid}:note:${id}`] : [];
  const list = useQuery(api.lists.getList, { listId });
  const note = useQuery(api.notes.getNoteBody, { listId });

  if (identityLoading || list === undefined || note === undefined) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse h-8 w-56 bg-stone-200 dark:bg-gray-800 rounded mb-4" />
        <div className="animate-pulse h-64 w-full bg-stone-200 dark:bg-gray-800 rounded" />
      </div>
    );
  }

  if (list && !isNote(list)) return <Navigate to={`/list/${list._id}`} replace />;

  if (!list || !note) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-stone-600 dark:text-stone-400">This note isn't available.</p>
        <UnsentNoteDrafts documentKey={draftKey} aliases={draftAliases} />
        <Link to="/d" className="rounded-full px-4 py-2 text-sm font-semibold bg-amber-500 text-white">
          Back to lists
        </Link>
      </div>
    );
  }

  return <LoadedNote key={draftKey} list={list} note={note} draftKey={draftKey} draftAliases={draftAliases} />;
}

// Split out so the initial mode can be derived once from the first loaded body.
function LoadedNote({ list, note, draftKey, draftAliases }: { list: Doc<"lists">; note: NoteBody; draftKey?: string; draftAliases: readonly string[] }) {
  const navigate = useNavigate();
  const { did, legacyDid } = useCurrentUser();
  const isOwner = list.ownerDid === did || list.ownerDid === legacyDid;
  const { haptic } = useSettings();
  const { isOnline } = useOffline();
  const { categories } = useCategories();
  const updateNoteBody = useMutation(api.notes.updateNoteBody);

  const [chosenMode, setChosenMode] = useState<Mode>(() => (note.body.trim() ? "preview" : "edit"));

  const [dialog, setDialog] = useState<"rename" | "category" | "delete" | null>(null);

  const { value, onChange, status, retry, useServer, saveDraft, dirty, otherDrafts, recoverDraft, discardStoredDraft } = useAutosaveDraft({
    saved: note.body,
    draftKey,
    draftAliases,
    canEdit: note.canEdit && !!draftKey,
    accessCheckedAt: note.accessCheckedAt,
    persist: async (text, expectedBody) => {
      await updateNoteBody({ listId: list._id, body: text, expectedBody });
    },
  });

  const editingUnavailable = !note.canEdit || !draftKey || status === "denied";
  const mode: Mode = editingUnavailable ? "preview" : chosenMode;
  const displayBody = editingUnavailable ? note.body : value;

  if (status === "denied") {
    return <div className="max-w-3xl mx-auto">
      <p>This note isn't available for editing.</p>
      <UnsentNoteDrafts documentKey={draftKey} aliases={draftAliases} onDiscard={discardStoredDraft} />
      <Link to="/d" className="underline">Back to lists</Link>
    </div>;
  }

  const categoryName = categories.find((c) => c._id === list.categoryId)?.name;
  const words = wordCount(displayBody);
  const nearLimit = displayBody.length > MAX_NOTE_LENGTH - 500;
  const statusLabel = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";
  const meta = [
    "note",
    categoryName?.toLowerCase(),
    `${words} ${words === 1 ? "word" : "words"}`,
    `edited ${shortRelativeTime(note.updatedAt)}`,
  ].filter(Boolean);

  const pickMode = (next: Mode) => {
    haptic('light');
    setChosenMode(next);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-start gap-3">
          <Link
            to="/d"
            onClick={() => haptic('light')}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            aria-label="Back to lists"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="text-gray-900 dark:text-gray-100 break-words min-w-0"
                style={{
                  fontFamily: 'Nunito, system-ui, sans-serif',
                  fontWeight: 700,
                  fontSize: 'clamp(24px, 4.5vw, 32px)',
                  letterSpacing: -0.9,
                  lineHeight: 1.05,
                  margin: 0,
                }}
              >
                {list.name}
              </h1>
              <ListVerificationBadge hasVC={!!list.assetDid} anchorStatus="none" did={list.assetDid} />
            </div>
            <div
              className="flex items-center gap-2 text-[12px] mt-1 text-stone-500 dark:text-stone-400 flex-wrap"
              style={{ fontFamily: MONO }}
            >
              {meta.map((part, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  {i > 0 && <span className="text-stone-300 dark:text-stone-600">·</span>}
                  <span>{part}</span>
                </span>
              ))}
              <span className="text-stone-400" aria-live="polite">
                {status === "error" ? (
                  <span role="alert" className="text-red-600 dark:text-red-400">
                    Not saved to server. Draft kept on this device.{' '}
                    <button type="button" onClick={retry} className="underline">Retry</button>
                  </span>
                ) : statusLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!editingUnavailable && (
              <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5">
                <ModeButton active={mode === "edit"} label="Edit" onClick={() => pickMode("edit")}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </ModeButton>
                <ModeButton active={mode === "preview"} label="Preview" onClick={() => pickMode("preview")}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </ModeButton>
              </div>
            )}

            <HeaderActionsMenu
              subject="note"
              canShare={isOwner}
              canPublish={false}
              canSaveTemplate={false}
              canRename={isOwner}
              canChangeCategory={isOwner}
              canDelete={isOwner}
              isOnline={isOnline}
              isPublished={false}
              onShare={() => navigate(`/invitations?listId=${encodeURIComponent(list._id)}`)}
              onPublish={() => {}}
              onSaveTemplate={() => {}}
              onRename={() => setDialog("rename")}
              onChangeCategory={() => setDialog("category")}
              onDelete={() => setDialog("delete")}
              haptic={haptic}
            />
          </div>
        </div>
      </div>

      {!isOwner && <Link to="/shared" className="inline-block mb-4 underline">Your access · Shared with me</Link>}
      {editingUnavailable
        ? <UnsentNoteDrafts documentKey={draftKey} aliases={draftAliases} onDiscard={discardStoredDraft} />
        : <RecoveredNoteDrafts drafts={otherDrafts} disabled={dirty} onRecover={recoverDraft} />}
      {!editingUnavailable && status === "conflict" && <NoteConflict serverBody={note.body} onUseServer={useServer} onSaveDraft={saveDraft} />}
      {mode === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          aria-label="Note body"
          placeholder="Start writing…  (markdown supported)"
          className="w-full min-h-[60vh] resize-none bg-transparent text-base leading-relaxed text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none font-mono"
        />
      ) : (
        <div className="w-full prose prose-stone dark:prose-invert max-w-none">
          {displayBody.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayBody}</ReactMarkdown>
          ) : (
            <p className="text-stone-400">Nothing to preview yet.</p>
          )}
        </div>
      )}
      {nearLimit && (
        <p className="pt-2 text-xs text-stone-400 text-right">
          {displayBody.length} / {MAX_NOTE_LENGTH}
        </p>
      )}

      <Suspense fallback={null}>
        {isOwner && dialog === "delete" && (
          <DeleteListDialog list={list} onClose={() => setDialog(null)} onDeleted={() => navigate("/d")} />
        )}
        {isOwner && dialog === "rename" && (
          <RenameListDialog list={list} onClose={() => setDialog(null)} />
        )}
        {isOwner && dialog === "category" && (
          <ChangeCategoryDialog listId={list._id} currentCategoryId={list.categoryId} onClose={() => setDialog(null)} />
        )}
      </Suspense>
    </div>
  );
}

function ModeButton({ active, label, onClick, children }: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full transition-all active:scale-95 ${
        active
          ? "bg-white dark:bg-gray-600 text-amber-600 dark:text-amber-400 shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">{children}</svg>
    </button>
  );
}
