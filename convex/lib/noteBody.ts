/**
 * Pure note helpers shared by Convex functions, the client and the Node tests.
 * Type-only imports keep it free of Convex runtime code.
 */
import type { Id } from "../_generated/dataModel";

/** Max length of a markdown body, for both item notes and note bodies. */
export const MAX_NOTE_LENGTH = 50000;

export type NoteCardSummary = {
  listId: Id<"lists">;
  excerpt: string;
  wordCount: number;
  updatedAt: number;
};

export function isNote(list: { kind?: "note" }): boolean {
  return list.kind === "note";
}

export function wordCount(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Plain-text preview of a markdown body, cut at `max` characters. */
export function excerpt(body: string, max = 160): string {
  const plain = body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/`+/g, "")
    // No lookbehind: the iOS 15 WebView would fail to parse the whole bundle.
    .replace(/\*{1,3}|~~/g, "")
    .replace(/\b_{1,3}|_{1,3}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
