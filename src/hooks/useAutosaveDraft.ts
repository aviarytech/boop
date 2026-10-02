import { useState, useEffect, useRef, useCallback } from "react";
import { clearDraft, draftText, readDraft, writeDraft } from "../lib/noteDrafts";
import { clampNote } from "../lib/noteEditor";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 600;

/**
 * Local draft over a server-owned markdown value: debounced autosave, and a
 * flush of any pending edit on unmount. `saved` is undefined while loading.
 */
export function useAutosaveDraft({
  saved,
  draftKey,
  canEdit,
  persist,
}: {
  saved: string | undefined;
  /** Callers must remount the hook when this account/resource key changes. */
  draftKey?: string;
  canEdit: boolean;
  persist: (text: string) => Promise<void>;
}) {
  // null = no local edit yet, so the view keeps tracking the server value.
  const [draft, setDraft] = useState<string | null>(() => draftKey ? draftText(draftKey) : null);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const value = draft ?? saved ?? "";
  // Flush even a draft equal to the current server snapshot: an older write
  // may still be in flight, and must not undo a user's revert on navigation.
  const dirty = saved !== undefined && canEdit && draft !== null;

  // Refs feed the unmount flush; they are written in an effect, never during render.
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  const persistRef = useRef(persist);
  const draftRecordRef = useRef(draftKey ? readDraft(draftKey) : null);

  useEffect(() => {
    valueRef.current = value;
    dirtyRef.current = dirty;
    persistRef.current = persist;
  });

  const save = useCallback(async (text: string) => {
    const record = draftRecordRef.current;
    setStatus("saving");
    try {
      await persistRef.current(text);
      if (draftKey) clearDraft(draftKey, record);
      // Resume tracking the server value, unless the user typed something newer.
      if (valueRef.current === text) {
        setDraft(null);
        setStatus("saved");
      }
    } catch {
      setStatus("error");
    }
  }, [draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void save(value), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, dirty, save]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) void save(valueRef.current);
    };
  }, [save]);

  const onChange = (next: string) => {
    const text = clampNote(next);
    // Synchronous: navigation can happen before effects or the debounce run.
    if (draftKey) draftRecordRef.current = writeDraft(draftKey, text);
    valueRef.current = text;
    dirtyRef.current = canEdit && saved !== undefined;
    setDraft(text);
    setStatus("idle");
  };

  // Warn before a reload/close destroys a draft that has not reached the server.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const retry = () => {
    if (dirtyRef.current) void save(valueRef.current);
  };

  return { value, onChange, status, dirty, retry };
}
