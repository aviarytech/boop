/**
 * PROTOTYPE — throwaway. In-memory mock data for /prototype/notes-index.
 * A note IS a list row (same table, same assetDid), prose only, zero items.
 */

import type { VerificationState } from "../../components/VerificationBadge";

export type MockCategoryId = "home" | "work";

export interface MockCategory {
  id: MockCategoryId;
  name: string;
}

export const MOCK_CATEGORIES: MockCategory[] = [
  { id: "home", name: "Home" },
  { id: "work", name: "Work" },
];

export const ME = "did:webvh:QmYx7…:boop.ad:brian";

export interface MockEntry {
  id: string;
  kind: "list" | "note";
  name: string;
  categoryId: MockCategoryId | null;
  ownerDid: string;
  createdAt: number;
  updatedAt: number;
  assetDid: string;
  /** Sealed by the migration — no signing key, can't record new events. */
  isLegacy?: boolean;
  /** Published via a site: hasVC + anchor state. */
  published?: { anchorStatus: VerificationState; blockHeight?: number };
  /** Lists only */
  items?: { total: number; done: number };
  /** Notes only — markdown body */
  body?: string;
  /** Notes only — sealed versions in the CEL log */
  sealedVersions?: number;
}

const H = 3600_000;
const D = 24 * H;
const now = Date.now();

export const MOCK_ENTRIES: MockEntry[] = [
  {
    id: "note-why-sign",
    kind: "note",
    name: "Why boop signs every list",
    categoryId: "work",
    ownerDid: ME,
    createdAt: now - 9 * D,
    updatedAt: now - 2 * H,
    assetDid: "did:cel:z6MkrHKzgsahxBLyNvJ9x4G2Q",
    published: { anchorStatus: "verified", blockHeight: 918_204 },
    sealedVersions: 3,
    body: `# Why boop signs every list

Every list in boop is an Originals asset with its own DID. That sounds like plumbing, but it is the whole point: when you share a list, the person on the other end can check **who made it** and **that nobody has edited it since**.

## What that buys you

- A published note is a claim you can stand behind.
- A forwarded screenshot is not.
- If I change my mind, the log shows *when* I changed it — not a silent overwrite.

## What it costs

Each seal writes an event to the CEL log (~720 bytes). The log can never be compacted, so the note's history is as permanent as the note. That is the trade we are making on purpose.

> Provenance is the product. The editor is just where you type.
`,
  },
  {
    id: "list-groceries",
    kind: "list",
    name: "Weekly groceries",
    categoryId: "home",
    ownerDid: ME,
    createdAt: now - 3 * D,
    updatedAt: now - 5 * H,
    assetDid: "did:cel:z6MkfQ3pV8yXk2nLwT4mR7sE9",
    items: { total: 12, done: 4 },
  },
  {
    id: "list-launch",
    kind: "list",
    name: "Launch checklist",
    categoryId: "work",
    ownerDid: ME,
    createdAt: now - 12 * D,
    updatedAt: now - 1 * D,
    assetDid: "did:cel:z6MkjT9vB2cXq5wLp3nH8dK4M",
    published: { anchorStatus: "verified", blockHeight: 917_811 },
    items: { total: 9, done: 7 },
  },
  {
    id: "note-sourdough",
    kind: "note",
    name: "Sourdough starter log",
    categoryId: "home",
    ownerDid: ME,
    createdAt: now - 20 * D,
    updatedAt: now - 1 * D,
    assetDid: "did:cel:z6MkpL2wR8nYt5vXc7qB3hJ6F",
    sealedVersions: 1,
    body: `# Sourdough starter log

**Day 1** — 50g rye, 50g water. Nothing. Expected.

**Day 3** — first bubbles, sour smell. Fed 1:1:1 at 8am. Doubled by 4pm which is faster than the book says; the kitchen is warm.

**Day 5** — dropped it. Half of it went on the floor. Kept the rest and fed it, pretending nothing happened.

**Day 7** — passed the float test. Baked the first loaf: dense, flat, tastes right. Next time: longer bulk, less flour on the bench.

Things to try
- Overnight retard in the fridge
- 80% hydration (probably a mistake)
- Feed with bread flour only and see if the rise changes
`,
  },
  {
    id: "list-costco",
    kind: "list",
    name: "Costco run",
    categoryId: "home",
    ownerDid: ME,
    createdAt: now - 130 * D,
    updatedAt: now - 40 * D,
    assetDid: "did:cel:z6MkaN4xT7pQw2mVs9yL5cR8H",
    isLegacy: true,
    items: { total: 8, done: 0 },
  },
  {
    id: "note-originals-sync",
    kind: "note",
    name: "Originals sync — 24 Sep",
    categoryId: "work",
    ownerDid: ME,
    createdAt: now - 6 * D,
    updatedAt: now - 6 * D,
    assetDid: "did:cel:z6MkwE5rH3sPq9nTb2xK7vL4J",
    published: { anchorStatus: "pending" },
    sealedVersions: 2,
    body: `# Originals sync — 24 Sep

Present: Brian, Mara, Tomas.

## Decisions
1. Notes reuse the \`lists\` primitive. No new table, no new DID lifecycle.
2. Old note versions go hash-only in the envelope after the first seal; content stays in a live body table.
3. Mobile note-writing is not a ship blocker.

## Open
- Sealing granularity: every autosave is too chatty, "on publish" is too coarse. Something in between — explicit "seal" or an idle timer.
- Do notes get categories, or is "Notes" the category?

Next sync Thursday.
`,
  },
  {
    id: "list-weekend",
    kind: "list",
    name: "Weekend chores",
    categoryId: "home",
    ownerDid: ME,
    createdAt: now - 2 * D,
    updatedAt: now - 3 * H,
    assetDid: "did:cel:z6MkzC8vY4qWn6tRp1mL9xB2K",
    items: { total: 6, done: 3 },
  },
  {
    id: "note-garden",
    kind: "note",
    name: "Garden plan for spring",
    categoryId: null,
    ownerDid: ME,
    createdAt: now - 15 * D,
    updatedAt: now - 4 * D,
    assetDid: "did:cel:z6MkgR7tL2vXp8sQw3nY5hC9M",
    body: `Raised beds along the south fence get the most light, so tomatoes and peppers go there. The shady strip by the shed is fine for lettuce and herbs.

Order seeds by mid-February. Last year I waited until March and the good varieties were gone.

Compost is not ready — turn it twice more and check again in three weeks.
`,
  },
  {
    id: "list-camping",
    kind: "list",
    name: "Camping trip",
    categoryId: null,
    ownerDid: ME,
    createdAt: now - 200 * D,
    updatedAt: now - 60 * D,
    assetDid: "did:cel:z6MkbH9wQ5nXt3vLp7sR2yK4J",
    isLegacy: true,
    items: { total: 15, done: 2 },
  },
  {
    id: "list-lisbon",
    kind: "list",
    name: "Trip to Lisbon",
    categoryId: null,
    ownerDid: "did:webvh:QmTz2…:boop.ad:mara",
    createdAt: now - 8 * D,
    updatedAt: now - 1 * D,
    assetDid: "did:cel:z6MkqV3xN8tYw2pLs6rH4cB7K",
    items: { total: 11, done: 5 },
  },
];

export function wordCount(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}

/** First non-heading paragraph, stripped of markdown noise, for card excerpts. */
export function excerpt(body: string, max = 140): string {
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  const plain = (para ?? "")
    .replace(/[*_`>#]/g, "")
    .replace(/^\d+\.\s+|^-\s+/gm, "")
    .replace(/\s+/g, " ");
  return plain.length > max ? plain.slice(0, max).replace(/\s\S*$/, "") + "…" : plain;
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function truncateDid(did: string): string {
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}
