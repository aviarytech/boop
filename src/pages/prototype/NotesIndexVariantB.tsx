/* eslint-disable react-refresh/only-export-components -- prototype */
/**
 * PROTOTYPE — Variant B: two tabs, Lists / Notes.
 * Lists tab is today's index untouched. Notes tab is its own surface: a flat,
 * recency-sorted document list with no categories, and the note page is the
 * NoteEditor's compact header with a provenance strip — not the list header.
 * "New" is contextual: it makes whatever the current tab holds.
 */

import { useState } from "react";
import { CategoryHeader } from "../../components/lists/CategoryHeader";
import { SearchInput } from "../../components/ui/SearchInput";
import { LegacyBadge } from "../../components/LegacyBadge";
import { ItemVerificationBadge, ListVerificationBadge } from "../../components/VerificationBadge";
import { Panel } from "../../components/ui/Panel";
import { MOCK_CATEGORIES, ME, excerpt, formatRelativeTime, truncateDid, wordCount, type MockEntry } from "./notesIndexMock";
import { Fab, GreetingHero, MarkdownPreview, MockListCard, MONO, NewPill, NUNITO, PublishedDot, SecondaryChip, StaticMenu, StaticMenuLegend, TodaysListHeader } from "./notesIndexShared";
import type { VariantProps } from "./NotesIndexPrototype";

export const VARIANT_B = { key: "B", name: "Lists / Notes tabs" };

type Tab = "lists" | "notes";

/** Notes tab row: title, one-line excerpt, recency and provenance on the right. No categories. */
function NoteRowB({ entry, onOpen }: { entry: MockEntry; onOpen: () => void }) {
  const body = entry.body ?? "";
  return (
    <button type="button" onClick={onOpen} className="w-full text-left px-4 py-3.5 flex items-start gap-4 hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-stone-900 dark:text-stone-50 truncate" style={{ fontFamily: NUNITO, fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>{entry.name}</h3>
          {entry.isLegacy && <LegacyBadge />}
        </div>
        <p className="text-[13px] text-stone-500 dark:text-stone-400 truncate mt-0.5">{excerpt(body, 120)}</p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums" style={{ fontFamily: MONO }}>
        <span>{formatRelativeTime(entry.updatedAt)}</span>
        <span className="flex items-center gap-1.5">
          {entry.published && <PublishedDot label="published" />}
          {entry.published && <ItemVerificationBadge hasVC anchorStatus={entry.published.anchorStatus} did={entry.assetDid} />}
          {!entry.published && <span className="text-stone-400">v{entry.sealedVersions ?? 0} · private</span>}
        </span>
      </div>
    </button>
  );
}

/** Note page B: NoteEditor's compact sticky header, promoted, plus a provenance strip. */
function NotePageB({ entry, onBack }: { entry: MockEntry; onBack: () => void }) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const body = entry.body ?? "";
  return (
    <div className="-mx-4 -mt-6 min-h-full flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-10 bg-stone-50/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-stone-200 dark:border-gray-800">
        <div className="px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back" className="text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 text-sm">‹ Notes</button>
          <h1 className="flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{entry.name}</h1>
          <span className="text-xs text-stone-400 w-14 text-right" aria-live="polite">Saved</span>
          <button type="button" onClick={() => setMode(mode === "edit" ? "preview" : "edit")} className="rounded-full px-3 py-1.5 text-xs font-semibold bg-stone-100 dark:bg-gray-900 text-stone-700 dark:text-stone-200">
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
          <button type="button" aria-label="More" className="rounded-full w-8 h-8 text-stone-500 hover:bg-stone-100 dark:hover:bg-gray-900">⋯</button>
        </div>
        {/* Provenance strip — the wedge, always visible on a note. */}
        <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap text-[11px] text-stone-500 dark:text-stone-400" style={{ fontFamily: MONO }}>
          <ListVerificationBadge hasVC anchorStatus={entry.published?.anchorStatus ?? "none"} did={entry.assetDid} anchorBlockHeight={entry.published?.blockHeight} />
          <span>signed by {truncateDid(ME)}</span>
          <span className="text-stone-300 dark:text-stone-600">·</span>
          <span>v{entry.sealedVersions ?? 0} sealed {formatRelativeTime(entry.updatedAt)}</span>
          <span className="text-stone-300 dark:text-stone-600">·</span>
          <span>{wordCount(body)} words</span>
          {entry.isLegacy && <LegacyBadge />}
          <span className="ml-auto">
            <button type="button" className="rounded-full px-3 py-1 text-[11px] font-semibold text-white" style={{ background: "var(--boop-accent)" }}>
              {entry.published ? "Manage publication" : "Publish"}
            </button>
          </span>
        </div>
      </header>

      <main className="flex-1 flex gap-6 flex-wrap px-4 py-3">
        <div className="flex-1 min-w-[260px] flex flex-col">
          {mode === "edit" ? (
            <textarea defaultValue={body} className="flex-1 w-full min-h-[440px] resize-none bg-transparent text-base leading-relaxed text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none font-mono" />
          ) : (
            <MarkdownPreview body={body} />
          )}
        </div>
        <div>
          <StaticMenuLegend>⋯ menu (note)</StaticMenuLegend>
          <StaticMenu
            items={[
              { label: "Rename", icon: "✏️" },
              { label: "Share link", icon: "🔗" },
              { label: "Version history", icon: "🧾", hint: `${entry.sealedVersions ?? 0} sealed` },
              { label: "Delete note", icon: "🗑️", danger: true },
            ]}
          />
          <p className="mt-2 text-[10px] text-stone-400 max-w-[15rem] leading-snug" style={{ fontFamily: MONO }}>no category, no favourite, no template — those are list things</p>
        </div>
      </main>
    </div>
  );
}

function CreateB({ kind, onClose }: { kind: "list" | "note"; onClose: () => void }) {
  const [name, setName] = useState("");
  const isNote = kind === "note";
  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">✨</span>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isNote ? "New note" : "Create New List"}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{isNote ? "Title it, then start writing" : "Give your list a name"}</p>
        </div>
      </div>
      <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </>
  );
  const footer = (
    <div className="px-5 py-4 flex gap-3">
      <button type="button" onClick={onClose} className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium">Cancel</button>
      <button type="button" disabled={!name.trim()} onClick={onClose} className="flex-1 px-4 py-3 bg-amber-500 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50">
        {isNote ? "Start writing →" : "Create List"}
      </button>
    </div>
  );
  return (
    <Panel isOpen onClose={onClose} header={header} footer={footer}>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{isNote ? "Title" : "List name"}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isNote ? "e.g., Originals sync — 24 Sep" : "e.g., Groceries, Weekend Tasks"} className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500" />
        </div>
        {isNote ? (
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-snug">
            Notes don't use categories — find them by search or recency. Every save is signed with your DID; publishing lets anyone verify it.
          </p>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm">
              <option>Uncategorized</option>
              {MOCK_CATEGORIES.map((c) => <option key={c.id}>{c.name}</option>)}
              <option>+ Create new category</option>
            </select>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function VariantB({ entries, openId, setOpen, createKind, setCreate, tab, setTab }: VariantProps & { tab: Tab; setTab: (t: Tab) => void }) {
  const [query, setQuery] = useState("");
  const open = entries.find((e) => e.id === openId);
  if (open) {
    return open.kind === "note" ? <NotePageB entry={open} onBack={() => setOpen(null)} /> : <TodaysListHeader entry={open} onBack={() => setOpen(null)} />;
  }

  const q = query.trim().toLowerCase();
  const lists = entries.filter((e) => e.kind === "list" && (!q || e.name.toLowerCase().includes(q)));
  const notes = entries.filter((e) => e.kind === "note" && (!q || e.name.toLowerCase().includes(q) || (e.body ?? "").toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
  const owned = lists.filter((e) => e.ownerDid === ME).sort((a, b) => b.createdAt - a.createdAt);
  const shared = lists.filter((e) => e.ownerDid !== ME);
  const counts = { lists: entries.filter((e) => e.kind === "list").length, notes: entries.filter((e) => e.kind === "note").length, shared: shared.length };
  const createTarget: "list" | "note" = tab === "notes" ? "note" : "list";

  return (
    <div className="min-h-full pb-28">
      <GreetingHero
        counts={counts}
        subtitle={tab === "notes"
          ? (<>Your notes —<br /><span className="text-stone-500 dark:text-stone-400" style={{ fontWeight: 600 }}>what are you thinking?</span></>)
          : undefined}
      />

      {/* Tab switch — same pill style as the primary nav in the app header */}
      <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 dark:bg-gray-900 p-1 mb-4" role="tablist">
        {([["lists", "Lists", counts.lists], ["notes", "Notes", counts.notes]] as const).map(([key, label, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${tab === key ? "bg-white dark:bg-gray-800 text-stone-900 dark:text-stone-50 shadow-sm" : "text-stone-500 dark:text-stone-400 hover:text-stone-800"}`}
          >
            {label} <span className="text-stone-400 font-normal ml-0.5">{n}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2.5 mb-3 items-center">
        <div className="flex-1 min-w-0"><SearchInput value={query} onChange={setQuery} placeholder={tab === "notes" ? "Search notes and their text…" : "Search lists..."} className="w-full" /></div>
        <NewPill label={tab === "notes" ? "New note" : "New list"} onClick={() => setCreate(createTarget)} />
      </div>

      {tab === "lists" ? (
        <>
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <SecondaryChip><span>🎯</span><span>Focus</span></SecondaryChip>
            <SecondaryChip><span>📁</span><span>Categories</span></SecondaryChip>
          </div>
          <div className="space-y-8 animate-slide-up">
            <section>
              {MOCK_CATEGORIES.map((cat) => {
                const inCat = owned.filter((e) => e.categoryId === cat.id);
                if (!inCat.length) return null;
                return (
                  <CategoryHeader key={cat.id} name={cat.name} listCount={inCat.length}>
                    <div className="space-y-3">{inCat.map((e) => <MockListCard key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}</div>
                  </CategoryHeader>
                );
              })}
              {owned.some((e) => !e.categoryId) && (
                <CategoryHeader name="Uncategorized" listCount={owned.filter((e) => !e.categoryId).length}>
                  <div className="space-y-3">{owned.filter((e) => !e.categoryId).map((e) => <MockListCard key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}</div>
                </CategoryHeader>
              )}
            </section>
            {shared.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">🤝</span>
                  <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200">Shared with me</h2>
                  <span className="text-sm font-normal text-stone-500 dark:text-stone-400">({shared.length})</span>
                </div>
                <div className="space-y-3">{shared.map((e) => <MockListCard key={e.id} entry={e} onOpen={() => setOpen(e.id)} showOwner />)}</div>
              </section>
            )}
          </div>
        </>
      ) : (
        <div className="animate-slide-up">
          <div className="flex items-center gap-2 mb-3 text-[11px] text-stone-500 dark:text-stone-400" style={{ fontFamily: MONO }}>
            <span>sorted by last edited</span>
            <span className="text-stone-300 dark:text-stone-600">·</span>
            <span>{notes.filter((n) => n.published).length} published</span>
          </div>
          <div className="bg-white dark:bg-stone-800/70 rounded-2xl border border-stone-200/70 dark:border-stone-700/50 divide-y divide-stone-100 dark:divide-stone-700/60">
            {notes.map((e) => <NoteRowB key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}
          </div>
        </div>
      )}

      <Fab label={tab === "notes" ? "New note" : "Create new list"} onClick={() => setCreate(createTarget)} />
      {createKind && createKind !== "choose" && <CreateB kind={createKind} onClose={() => setCreate(null)} />}
    </div>
  );
}
