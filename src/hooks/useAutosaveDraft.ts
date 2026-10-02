import { useState, useEffect, useRef, useCallback } from "react";
import { clearDraft, draftBase, draftText, readDraft, writeDraft } from "../lib/noteDrafts";
import { clampNote } from "../lib/noteEditor";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/** Callers remount this hook when the account/resource key changes. */
export function useAutosaveDraft({ saved, draftKey, canEdit, persist }: {
  saved: string | undefined;
  draftKey?: string;
  canEdit: boolean;
  persist: (text: string, expectedBody: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(() => draftKey ? draftText(draftKey) : null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const value = draft ?? saved ?? "";
  const dirty = saved !== undefined && canEdit && draft !== null;
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  const savedRef = useRef(saved);
  const editRef = useRef(canEdit);
  const persistRef = useRef(persist);
  const recordRef = useRef(draftKey ? readDraft(draftKey) : null);
  const baseRef = useRef(draftKey && draft !== null ? draftBase(draftKey) : saved);
  const recoveredRef = useRef(draft !== null);
  const revisionRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const mountedRef = useRef(true);
  const conflict = dirty && (status === "conflict" ||
    (recoveredRef.current && !inFlightRef.current && baseRef.current !== saved));
  const conflictRef = useRef(conflict);

  useEffect(() => {
    valueRef.current = value;
    dirtyRef.current = dirty;
    savedRef.current = saved;
    editRef.current = canEdit;
    persistRef.current = persist;
    conflictRef.current = conflict;
  });

  const save = useCallback(async function drain(): Promise<void> {
    if (!dirtyRef.current || !editRef.current || conflictRef.current) return;
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
      const conflicted = String(error).includes("NOTE_CONFLICT");
      conflictRef.current = conflicted;
      if (mountedRef.current) setStatus(conflicted ? "conflict" : "error");
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
    return () => { mountedRef.current = false; void save(); };
  }, [save]);

  const onChange = (next: string) => {
    const text = clampNote(next);
    if (!dirtyRef.current) baseRef.current = savedRef.current;
    revisionRef.current++;
    if (draftKey) recordRef.current = writeDraft(draftKey, text, baseRef.current);
    valueRef.current = text;
    dirtyRef.current = canEdit && saved !== undefined;
    setDraft(text);
    // Editing a conflicted draft must not silently authorize an overwrite.
    if (!conflictRef.current) setStatus("idle");
  };

  const useServer = () => {
    if (inFlightRef.current) return;
    if (draftKey) clearDraft(draftKey, recordRef.current);
    revisionRef.current++;
    recoveredRef.current = false;
    conflictRef.current = false;
    dirtyRef.current = false;
    setDraft(null);
    setStatus("idle");
  };
  const saveDraft = () => {
    if (inFlightRef.current || !editRef.current || savedRef.current === undefined) return;
    baseRef.current = savedRef.current;
    recoveredRef.current = false;
    conflictRef.current = false;
    if (draftKey) recordRef.current = writeDraft(draftKey, valueRef.current, baseRef.current);
    setStatus("idle");
    void save();
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return { value, onChange, status: conflict ? "conflict" as const : status,
    dirty, retry: save, useServer, saveDraft };
}
