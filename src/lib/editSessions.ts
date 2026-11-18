/**
 * Edit sessions: one signed `item.edited` record for a run of saves (#286).
 *
 * A note autosaves as it is typed, and a form can be saved field by field.
 * Each save still goes to the server at once; what is held back is the action
 * record. Saves of one item from this device carry the same `editSession` id,
 * the server adds each to that session instead of recording it, and when the
 * session ends this module has the author sign the session's final values
 * once (`recordItemEdit`). See docs/action-records.md, "Edit sessions".
 *
 * Free of the Turnkey stack and of React, like actionSigner.ts: the app
 * installs the recorder (src/hooks/useEditSessionRecords.ts).
 */
import { itemEdit, type ItemEdit } from "../../shared/actionRecord";

/**
 * How long after an item's last save its session is closed and signed.
 * Autosave fires 600 ms after the last keystroke (useAutosaveDraft), and a
 * save takes a round trip, so anything under about two seconds would split
 * ordinary typing pauses into separate records. Five seconds keeps a pause to
 * think inside one session, and is still short enough that the record is
 * normally written while the author is on the page, which is what limits how
 * much a crash can leave unrecorded.
 */
export const EDIT_SESSION_IDLE_MS = 5000;
/** A session whose record could not be sent is retried this many times, then given up. */
const MAX_RECORD_ATTEMPTS = 3;

/** Signs and sends one session's record. Rejects when it could not be sent. */
export type EditRecorder = (itemId: string, editSession: string, after: ItemEdit) => Promise<void>;

type Session = {
  id: string;
  /** What this session's acknowledged saves set, later saves winning per field. */
  after: ItemEdit | null;
  /** Saves sent and not yet answered. A session is never closed over one. */
  inflight: number;
  /** Asked to close while a save was in flight: close as soon as it is answered. */
  closing: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
type Unsent = { itemId: string; id: string; after: ItemEdit; attempts: number };

let recorder: EditRecorder | null = null;
const sessions = new Map<string, Session>();
let unsent: Unsent[] = [];

export function setEditRecorder(next: EditRecorder | null): void {
  recorder = next;
}

/** Whether saves are being coalesced. Without a recorder each save is recorded on its own. */
export const editSessionsEnabled = (): boolean => recorder !== null;

/** A save of `itemId` is about to be sent: the session id it must carry. */
export function beginItemEdit(itemId: string): string {
  let session = sessions.get(itemId);
  if (!session) {
    session = { id: crypto.randomUUID(), after: null, inflight: 0, closing: false };
    sessions.set(itemId, session);
  }
  clearTimeout(session.timer);
  session.inflight++;
  return session.id;
}

/**
 * The save sent under `editSession` was answered. `saved` is its arguments
 * when the server applied it, null when it failed (it is then no part of the
 * session: the server did not add it either).
 */
export function settleItemEdit(itemId: string, editSession: string, saved: Record<string, unknown> | null): void {
  const session = sessions.get(itemId);
  if (!session || session.id !== editSession) return;
  session.inflight = Math.max(0, session.inflight - 1);
  const edit = saved ? itemEdit(saved) : null;
  if (edit) session.after = { ...session.after, ...edit };
  if (session.inflight > 0) return;
  if (!session.after) { sessions.delete(itemId); return; }
  if (session.closing) void flushEditSession(itemId);
  else session.timer = setTimeout(() => void flushEditSession(itemId), EDIT_SESSION_IDLE_MS);
}

async function send(entry: Unsent): Promise<void> {
  try {
    if (!recorder) throw new Error("No edit recorder");
    await recorder(entry.itemId, entry.id, entry.after);
  } catch (err) {
    // Kept for the next flush (back online, tab shown again, next navigation).
    if (++entry.attempts < MAX_RECORD_ATTEMPTS) unsent.push(entry);
    else console.warn("[editSessions] Edit left unrecorded; its record could not be sent:", err);
  }
}

/**
 * Close `itemId`'s session now and record it. With a save still in flight the
 * session closes when that save is answered, so the record never races it.
 */
export async function flushEditSession(itemId: string): Promise<void> {
  const session = sessions.get(itemId);
  if (!session) return;
  clearTimeout(session.timer);
  if (session.inflight > 0) { session.closing = true; return; }
  // Saves from here on open a new session: this one's record is being signed.
  sessions.delete(itemId);
  if (session.after) await send({ itemId, id: session.id, after: session.after, attempts: 0 });
}

/** Close every open session, and retry records that could not be sent earlier. */
export async function flushEditSessions(): Promise<void> {
  const retry = unsent;
  unsent = [];
  await Promise.all([...retry.map(send), ...[...sessions.keys()].map(flushEditSession)]);
}

/** Test hook: forget everything without recording it. */
export function resetEditSessions(): void {
  for (const session of sessions.values()) clearTimeout(session.timer);
  sessions.clear();
  unsent = [];
}
