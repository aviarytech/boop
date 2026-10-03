import { test, expect, beforeEach } from "bun:test";
import {
  loadColumnPrefs,
  saveColumnPrefs,
  DEFAULT_COLUMN_PREFS,
  type ColumnPrefs,
} from "./explorerColumns";

const KEY = "boop:explorer:columns";

beforeEach(() => {
  localStorage.clear();
});

test("loadColumnPrefs returns defaults when storage is empty", () => {
  expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
});

test("saveColumnPrefs round-trips through localStorage", () => {
  const next: ColumnPrefs = { identifier: true, collaborators: false, anchorTxidPrefix: true };
  saveColumnPrefs(next);
  expect(localStorage.getItem(KEY)).toBe(JSON.stringify(next));
  expect(loadColumnPrefs()).toEqual(next);
});

test("loadColumnPrefs falls back to defaults on corrupt JSON", () => {
  localStorage.setItem(KEY, "{not json");
  expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
});

test("loadColumnPrefs falls back to defaults on partial/invalid shape", () => {
  localStorage.setItem(KEY, JSON.stringify({ identifier: "yes" }));
  expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
});
