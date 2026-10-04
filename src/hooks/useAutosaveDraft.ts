import { authErrorData } from "../../convex/lib/authError";
import { isNoteConflict } from "../../convex/lib/noteConflict";
import { useState, useEffect, useRef, useCallback } from "react";
import { reconcileDraftAccess, draftIsDetached, sameDraftRevision, subscribeDrafts, draftRevision, clearDraft, clearRecoveredDraft, releaseDraft, listDrafts, readDraft, writeDraft, type StoredDraft } from "../lib/noteDrafts";
import { clampNote } from "../lib/noteEditor";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict" | "denied";

/** Callers remount this hook when the account/resource key changes. */
export function useAutosaveDraft({ saved, draftKey: documentKey, draftAliases = [], canEdit, accessCheckedAt, persist }: {
  saved: string | undefined;
  draftKey?: string;
  draftAliases?: readonly string[];
  canEdit: boolean;
  accessCheckedAt?: number;
  persist: (text: string, expectedBody: string) => Promise<void>;
}) {
  const [session] = useState(() => ({
    key: documentKey ? `${documentKey}:session:${draftRevision()}` : undefined,
    source: documentKey ? listDrafts(documentKey, draftAliases).find(draft => !draft.detached) : undefined,
  }));
  const draftKey = session.key;
  // A cached canEdit boolean is not evidence of regrant. Only a newer
  // timestamp from the server query may supersede a cross-tab denial.
  useEffect(() => {
    if (documentKey && accessCheckedAt !== undefined) reconcileDraftAccess(documentKey, canEdit, accessCheckedAt);
  }, [documentKey, canEdit, accessCheckedAt]);
  const sourceRef = useRef(session.source);
  const [draft, setDraft] = useState<string | null>(session.source?.text ?? null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const value = draft ?? saved ?? "";
  const dirty = saved !== undefined && canEdit && draft !== null;
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  const savedRef = useRef(saved);
  const editRef = useRef(canEdit);
  const persistRef = useRef(persist);
  const recordRef = useRef<string | null>(session.source?.record ?? null);
  const baseRef = useRef(session.source ? session.source.base : saved);
  const recoveredRef = useRef(draft !== null);
  const revisionRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const mountedRef = useRef(true);
  const conflict = status !== "denied" && dirty && (status === "conflict" ||
    (recoveredRef.current && !inFlightRef.current && baseRef.current !== saved));
  const conflictRef = useRef(conflict);
  const deniedRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
    dirtyRef.current = dirty;
    savedRef.current = saved;
    editRef.current = canEdit;
    persistRef.current = persist;
    conflictRef.current = conflict;
  });

  const save = useCallback(async function drain(): Promise<void> {
    if (draftKey && draftIsDetached(draftKey)) {
      deniedRef.current = true; baseRef.current = undefined; sourceRef.current = undefined; recordRef.current = readDraft(draftKey);
      if (mountedRef.current) setStatus("denied");
      return;
    }
    if (!dirtyRef.current || !editRef.current || conflictRef.current || deniedRef.current) return;
    if (inFlightRef.current) { queuedRef.current = true; return; }
    const base = baseRef.current;
    if (base === undefined) return;
    inFlightRef.current = true;
    queuedRef.current = false;
    const text = valueRef.current;
    const revision = revisionRef.current;
    const record = recordRef.current;
    if (mountedRef.current) setStatus("saving");
    let succeeded = false;
    try {
      await persistRef.current(text, base);
      succeeded = true;
      conflictRef.current = false;
      baseRef.current = text;
      recoveredRef.current = false;
      // Equal text does not imply equal edits (A -> B -> A).
      if (revisionRef.current === revision) {
        if (draftKey) clearDraft(draftKey, record);
        const source = sourceRef.current;
        if (source) clearRecoveredDraft(source);
        sourceRef.current = undefined;
        dirtyRef.current = false;
        if (mountedRef.current) { setDraft(null); setStatus("saved"); }
      } else {
        // Only rebase this editor's draft; never overwrite another tab's record.
        if (draftKey && readDraft(draftKey) === recordRef.current) {
          recordRef.current = writeDraft(draftKey, valueRef.current, text);
        }
        queuedRef.current = true;
      }
    } catch (error) {
      const denied = authErrorData(error)?.code === "FORBIDDEN";
      deniedRef.current = denied;
      const conflicted = !denied && isNoteConflict(error);
      conflictRef.current = conflicted;
      if (mountedRef.current) setStatus(denied ? "denied" : conflicted ? "conflict" : "error");
    } finally {
      inFlightRef.current = false;
      if (succeeded && queuedRef.current) await drain();
    }
  }, [draftKey]);

  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [value, dirty, conflict, save]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = (event: PageTransitionEvent) => {
      // BFCache pages can resume editing; they retain ownership.
      if (!event.persisted && draftKey) releaseDraft(draftKey);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      // React StrictMode replays cleanup/setup without ending the editor.
      queueMicrotask(() => {
        if (!mountedRef.current && draftKey) releaseDraft(draftKey);
      });
      void save();
    };
  }, [save, draftKey]);

  useEffect(() => subscribeDrafts(() => {
    if (draftKey && draftIsDetached(draftKey) && dirtyRef.current) {
      deniedRef.current = true; baseRef.current = undefined; sourceRef.current = undefined; recordRef.current = readDraft(draftKey);
      if (mountedRef.current) setStatus("denied");
    }
  }), [draftKey]);

  const onChange = (next: string) => {
    const text = clampNote(next);
    if (!dirtyRef.current) baseRef.current = savedRef.current;
    revisionRef.current++;
    if (draftKey) recordRef.current = writeDraft(draftKey, text, baseRef.current);
    valueRef.current = text;
    dirtyRef.current = canEdit && saved !== undefined;
    setDraft(text);
    // Editing a conflicted draft must not silently authorize an overwrite.
    if (!conflictRef.current && !deniedRef.current) setStatus("idle");
  };

  const useServer = () => {
    if (inFlightRef.current) return;
    if (draftKey) clearDraft(draftKey, recordRef.current);
    const source = sourceRef.current;
    if (source) clearRecoveredDraft(source);
    sourceRef.current = undefined;
    revisionRef.current++;
    recoveredRef.current = false;
    conflictRef.current = false;
    dirtyRef.current = false;
    setDraft(null);
    setStatus("idle");
  };
  const saveDraft = () => {
    if (inFlightRef.current || !editRef.current || deniedRef.current || savedRef.current === undefined) return;
    baseRef.current = savedRef.current;
    recoveredRef.current = false;
    conflictRef.current = false;
    if (draftKey) recordRef.current = writeDraft(draftKey, valueRef.current, baseRef.current);
    setStatus("idle");
    void save();
  };

  const recoverDraft = (stored: StoredDraft) => {
    if (stored.detached || dirtyRef.current || inFlightRef.current || !editRef.current) return;
    if (readDraft(stored.key) !== stored.record) return;
    sourceRef.current = stored;
    baseRef.current = stored.base;
    recoveredRef.current = true;
    revisionRef.current++;
    recordRef.current = stored.record;
    valueRef.current = stored.text;
    dirtyRef.current = true;
    setDraft(stored.text);
    setStatus("idle");
  };
  // Recovery may discard a stored record while this editor remains mounted
  // (e.g. viewer downgrade). Do not resurrect that exact draft if editing returns.
  const discardStoredDraft = (stored: StoredDraft) => {
    if (!sameDraftRevision(stored.record, recordRef.current) ||
        (stored.key !== draftKey && stored.key !== sourceRef.current?.key)) return;
    revisionRef.current++;
    recordRef.current = null;
    sourceRef.current = undefined;
    recoveredRef.current = false;
    conflictRef.current = false;
    dirtyRef.current = false;
    setDraft(null);
    deniedRef.current = false;
    setStatus("idle");
  };
  const otherDrafts = documentKey ? listDrafts(documentKey, draftAliases).filter(candidate =>
    candidate.key !== draftKey && candidate.key !== sourceRef.current?.key) : [];

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return { value, onChange, status: conflict ? "conflict" as const : status === "denied" && !canEdit ? "idle" as const : status,
    dirty, retry: save, useServer, saveDraft, otherDrafts, recoverDraft, discardStoredDraft };
}
