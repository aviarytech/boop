/* eslint-disable react-refresh/only-export-components -- prototype */
/**
 * PROTOTYPE — Variant A: one mixed stream.
 * Notes sit in the same category sections as lists; the card shape tells them
 * apart (prose excerpt + word count instead of a progress bar). "New" asks
 * list-or-note first. The note header keeps the list header's layout and swaps
 * the item-view pill for Edit/Preview.
 */

import { useState } from "react";
import { CategoryHeader } from "../../components/lists/CategoryHeader";
import { SearchInput } from "../../components/ui/SearchInput";
import { LegacyBadge } from "../../components/LegacyBadge";
import { ItemVerificationBadge, ListVerificationBadge } from "../../components/VerificationBadge";
import { Panel } from "../../components/ui/Panel";
import { MOCK_CATEGORIES, ME, excerpt, formatRelativeTime, wordCount, type MockEntry } from "./notesIndexMock";
import {
  BackButton, Fab, GreetingHero, MarkdownPreview, MockListCard, MoreIcon, MONO, NewPill, NUNITO,
  PublishedDot, RoundIconButton, SecondaryChip, SegmentedPill, ShareIcon, StaticMenu, StaticMenuLegend, TodaysListHeader, tagLine,
} from "./notesIndexShared";
import type { VariantProps } from "./NotesIndexPrototype";

export const VARIANT_A = { key: "A", name: "Mixed stream" };

/** Note card: same shell as the list card, prose where the progress bar was. */
function NoteCardA({ entry, onOpen }: { entry: MockEntry; onOpen: () => void }) {
  const body = entry.body ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left relative overflow-hidden bg-white dark:bg-stone-800/70 rounded-[18px] p-[18px] border border-stone-200/70 dark:border-stone-700/50 hover:border-amber-300/60 dark:hover:border-amber-700/50 hover:-translate-y-[1px] transition-all duration-150 active:scale-[0.99]"
      aria-label={`Open note: ${entry.name}`}
    >
      <div className="relative flex justify-between items-start mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-stone-500 dark:text-stone-400 lowercase" style={{ fontFamily: MONO }}>
            <span className="truncate">{["note", ...tagLine(entry)].join(" · ")}</span>
            {entry.isLegacy && <LegacyBadge className="flex-shrink-0" />}
            {entry.published && <PublishedDot />}
          </div>
          <h3 className="text-stone-900 dark:text-stone-50 truncate" style={{ fontFamily: NUNITO, fontWeight: 700, fontSize: 20, letterSpacing: -0.4, lineHeight: 1.15 }}>
            {entry.name}
          </h3>
        </div>
        {entry.published && (
          <div className="flex-shrink-0 ml-2">
            <ItemVerificationBadge hasVC anchorStatus={entry.published.anchorStatus} did={entry.assetDid} />
          </div>
        )}
      </div>
      <p className="text-[13.5px] leading-snug text-stone-600 dark:text-stone-300 line-clamp-2 mb-3">{excerpt(body)}</p>
      <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums" style={{ fontFamily: MONO }}>
        <span>{wordCount(body)} words</span>
        <span className="text-stone-300 dark:text-stone-600">·</span>
        <span>edited {formatRelativeTime(entry.updatedAt)}</span>
        {entry.sealedVersions && (<><span className="text-stone-300 dark:text-stone-600">·</span><span>v{entry.sealedVersions}</span></>)}
      </div>
    </button>
  );
}

function Card({ entry, onOpen, showOwner }: { entry: MockEntry; onOpen: () => void; showOwner?: boolean }) {
  return entry.kind === "note" ? <NoteCardA entry={entry} onOpen={onOpen} /> : <MockListCard entry={entry} onOpen={onOpen} showOwner={showOwner} />;
}

const editPreviewIcons = [
  { key: "edit", label: "Edit", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> },
  { key: "preview", label: "Preview", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> },
];

/** Note header A: the list header's skeleton, with the item-view pill replaced by Edit/Preview. */
function NoteHeaderA({ entry, onBack }: { entry: MockEntry; onBack: () => void }) {
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const body = entry.body ?? "";
  const category = MOCK_CATEGORIES.find((c) => c.id === entry.categoryId);
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-start gap-3">
          <BackButton onClick={onBack} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-gray-900 dark:text-gray-100 break-words min-w-0" style={{ fontFamily: NUNITO, fontWeight: 700, fontSize: "clamp(24px, 4.5vw, 32px)", letterSpacing: -0.9, lineHeight: 1.05, margin: 0 }}>
                {entry.name}
              </h1>
              {entry.isLegacy && <LegacyBadge />}
              <ListVerificationBadge hasVC anchorStatus={entry.published?.anchorStatus ?? "none"} did={entry.assetDid} anchorBlockHeight={entry.published?.blockHeight} />
            </div>
            <div className="flex items-center gap-2 text-[12px] mt-1 text-stone-500 dark:text-stone-400 flex-wrap" style={{ fontFamily: MONO }}>
              <span>note</span>
              {category && (<><span className="text-stone-300 dark:text-stone-600">·</span><span>{category.name.toLowerCase()}</span></>)}
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span>{wordCount(body)} words</span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span>edited {formatRelativeTime(entry.updatedAt)}</span>
              {entry.sealedVersions && (<><span className="text-stone-300 dark:text-stone-600">·</span><span>v{entry.sealedVersions} sealed</span></>)}
              {entry.published && (<><span className="text-stone-300 dark:text-stone-600">·</span><PublishedDot /></>)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
              <SegmentedPill options={editPreviewIcons} value={mode} />
            </div>
            <RoundIconButton label="Add to favourites"><span className="text-sm leading-none">☆</span></RoundIconButton>
            <RoundIconButton label="Share"><ShareIcon /></RoundIconButton>
            <RoundIconButton label="More actions"><MoreIcon /></RoundIconButton>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          {mode === "preview" ? (
            <MarkdownPreview body={body} />
          ) : (
            <textarea
              defaultValue={body}
              className="w-full min-h-[420px] resize-none bg-transparent text-base leading-relaxed text-stone-900 dark:text-stone-100 focus:outline-none font-mono"
            />
          )}
        </div>
        <div>
          <StaticMenuLegend>more menu (note)</StaticMenuLegend>
          <StaticMenu
            items={[
              { label: "Keyboard shortcuts", icon: "⌨️" },
              { label: "Rename note", icon: "✏️" },
              { label: "Change category", icon: "📁" },
              { label: "Share link", icon: "🔗" },
              { label: "Publish note", icon: "📡" },
              { label: "Version history", icon: "🧾", hint: `${entry.sealedVersions ?? 0} sealed` },
              { label: "Delete note", icon: "🗑️", danger: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** "New" → pick a kind → name it. */
function CreateChooserA({ kind, onPick, onClose }: { kind: "choose" | "list" | "note"; onPick: (k: "list" | "note") => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const isNote = kind === "note";
  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{kind === "choose" ? "✨" : isNote ? "¶" : "☑"}</span>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{kind === "choose" ? "Create new" : isNote ? "New note" : "New list"}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{kind === "choose" ? "What are you making?" : isNote ? "Give your note a title" : "Give your list a name"}</p>
        </div>
      </div>
      <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg" aria-label="Close">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </>
  );
  const footer = kind === "choose" ? undefined : (
    <div className="px-5 py-4 flex gap-3">
      <button type="button" onClick={onClose} className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium">Cancel</button>
      <button type="button" disabled={!name.trim()} onClick={onClose} className="flex-1 px-4 py-3 bg-amber-500 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50">
        {isNote ? "Create note" : "Create list"}
      </button>
    </div>
  );
  return (
    <Panel isOpen onClose={onClose} header={header} footer={footer}>
      {kind === "choose" ? (
        <div className="p-5 grid grid-cols-2 gap-3">
          {([
            { k: "list" as const, icon: "☑", title: "List", blurb: "Items you check off. Share, categorize, save as a template." },
            { k: "note" as const, icon: "¶", title: "Note", blurb: "Prose you sign. Publish it and readers can verify who wrote it and that it hasn't changed." },
          ]).map((o) => (
            <button key={o.k} type="button" onClick={() => onPick(o.k)} className="text-left rounded-2xl border-2 border-stone-200 dark:border-stone-700 hover:border-amber-400 p-4 transition-colors bg-stone-50 dark:bg-gray-900">
              <div className="text-2xl mb-2" style={{ fontFamily: NUNITO }}>{o.icon}</div>
              <div className="font-bold text-stone-900 dark:text-stone-100" style={{ fontFamily: NUNITO }}>{o.title}</div>
              <div className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-snug">{o.blurb}</div>
            </button>
          ))}
          <p className="col-span-2 text-[11px] text-stone-400" style={{ fontFamily: MONO }}>a note is born a note — it can't be turned into a list later</p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{isNote ? "Note title" : "List name"}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isNote ? "e.g., Why boop signs every list" : "e.g., Groceries, Weekend Tasks"} className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm">
              <option>Uncategorized</option>
              {MOCK_CATEGORIES.map((c) => <option key={c.id}>{c.name}</option>)}
              <option>+ Create new category</option>
            </select>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function VariantA({ entries, openId, setOpen, createKind, setCreate }: VariantProps) {
  const [query, setQuery] = useState("");
  const open = entries.find((e) => e.id === openId);
  if (open) {
    return open.kind === "note" ? <NoteHeaderA entry={open} onBack={() => setOpen(null)} /> : <TodaysListHeader entry={open} onBack={() => setOpen(null)} />;
  }

  const q = query.trim().toLowerCase();
  const visible = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
  const owned = visible.filter((e) => e.ownerDid === ME).sort((a, b) => b.createdAt - a.createdAt);
  const shared = visible.filter((e) => e.ownerDid !== ME);
  const counts = { lists: entries.filter((e) => e.kind === "list").length, notes: entries.filter((e) => e.kind === "note").length, shared: shared.length };

  return (
    <div className="min-h-full pb-28">
      <GreetingHero counts={counts} />
      <div className="flex gap-2.5 mb-3 items-center">
        <div className="flex-1 min-w-0"><SearchInput value={query} onChange={setQuery} placeholder="Search lists and notes…" className="w-full" /></div>
        <NewPill label="New" onClick={() => setCreate("choose")} />
      </div>
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
                <div className="space-y-3">{inCat.map((e) => <Card key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}</div>
              </CategoryHeader>
            );
          })}
          {owned.some((e) => !e.categoryId) && (
            <CategoryHeader name="Uncategorized" listCount={owned.filter((e) => !e.categoryId).length}>
              <div className="space-y-3">{owned.filter((e) => !e.categoryId).map((e) => <Card key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}</div>
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
            <div className="space-y-3">{shared.map((e) => <Card key={e.id} entry={e} onOpen={() => setOpen(e.id)} showOwner />)}</div>
          </section>
        )}
      </div>

      <Fab label="Create new list or note" onClick={() => setCreate("choose")} />
      {createKind && <CreateChooserA kind={createKind} onPick={setCreate} onClose={() => setCreate(null)} />}
    </div>
  );
}
