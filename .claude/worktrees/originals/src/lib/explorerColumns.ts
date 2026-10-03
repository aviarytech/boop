/**
 * Column toggle persistence for the Originals Explorer.
 *
 * DOM-coupled (uses localStorage). Tested under bun test + happy-dom.
 * NOT bundled into Node-side scripts.
 */

const STORAGE_KEY = "boop:explorer:columns";

export interface ColumnPrefs {
  identifier: boolean;
  collaborators: boolean;
  anchorTxidPrefix: boolean;
}

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = {
  identifier: false,
  collaborators: false,
  anchorTxidPrefix: false,
};

function isValidColumnPrefs(value: unknown): value is ColumnPrefs {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.identifier === "boolean" &&
    typeof v.collaborators === "boolean" &&
    typeof v.anchorTxidPrefix === "boolean"
  );
}

export function loadColumnPrefs(): ColumnPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMN_PREFS;
    const parsed = JSON.parse(raw);
    return isValidColumnPrefs(parsed) ? parsed : DEFAULT_COLUMN_PREFS;
  } catch {
    return DEFAULT_COLUMN_PREFS;
  }
}

export function saveColumnPrefs(prefs: ColumnPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
