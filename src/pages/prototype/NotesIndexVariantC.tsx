/* eslint-disable react-refresh/only-export-components -- prototype */
/**
 * PROTOTYPE — Variant C: notes as a built-in folder.
 * Categories become a folder strip that filters one card grid. "Notes" is a
 * system folder pinned first: a note is whatever lives there. Note cards keep
 * the list card shell (the folder name is the type signal). "New" is today's
 * Create List modal — choosing the Notes folder turns the form into a note.
 * The note header is today's list header with the item-view pill dropped.
 */

import { useState } from "react";
import { SearchInput } from "../../components/ui/SearchInput";
import { LegacyBadge } from "../../components/LegacyBadge";
import { ItemVerificationBadge, ListVerificationBadge } from "../../components/VerificationBadge";
import { Panel } from "../../components/ui/Panel";
import { MOCK_CATEGORIES, ME, formatRelativeTime, wordCount, type MockEntry } from "./notesIndexMock";
import {
  BackButton, Fab, GreetingHero, MarkdownPreview, MockListCard, MoreIcon, MONO, NewPill, NUNITO,
  PublishedDot, RoundIconButton, ShareIcon, StaticMenu, StaticMenuLegend, TodaysListHeader, tagLine,
} from "./notesIndexShared";
import type { VariantProps } from "./NotesIndexPrototype";

export const VARIANT_C = { key: "C", name: "Notes as a built-in folder" };

export type Folder = "all" | "notes" | "home" | "work" | "uncategorized" | "shared";

function folderOf(e: MockEntry): Folder {
  if (e.ownerDid !== ME) return "shared";
  if (e.kind === "note") return "notes";
  return e.categoryId ?? "uncategorized";
}

/** Note card C: the list card shell verbatim; only the mono line and the bottom row differ. */
function NoteCardC({ entry, onOpen }: { entry: MockEntry; onOpen: () => void }) {
  const body = entry.body ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left relative overflow-hidden bg-white dark:bg-stone-800/70 rounded-[18px] p-[18px] border border-stone-200/70 dark:border-stone-700/50 hover:border-amber-300/60 dark:hover:border-amber-700/50 hover:-translate-y-[1px] transition-all duration-150 active:scale-[0.99]"
      aria-label={`Open note: ${entry.name}`}
    >
      <div className="relative flex justify-between items-start mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-stone-500 dark:text-stone-400 lowercase" style={{ fontFamily: MONO }}>
            <span className="truncate">{["📝 notes", ...tagLine(entry)].join(" · ")}</span>
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
      <div className="relative flex items-center gap-2.5 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums" style={{ fontFamily: MONO }}>
        <span className="flex-1 truncate">{wordCount(body)} words · edited {formatRelativeTime(entry.updatedAt)}</span>
        <span>v{entry.sealedVersions ?? 0}</span>
      </div>
    </button>
  );
}

/** Card with the folder name in the mono line (ListCard's "mono category line up top"). */
function ListCardC({ entry, onOpen }: { entry: MockEntry; onOpen: () => void }) {
  const cat = MOCK_CATEGORIES.find((c) => c.id === entry.categoryId)?.name.toLowerCase();
  return <MockListCard entry={entry} onOpen={onOpen} showOwner={entry.ownerDid !== ME} prefix={cat ? `📁 ${cat}` : undefined} />;
}

/** Note header C: today's list header, minus the item-view pill; the folder is the category. */
function NoteHeaderC({ entry, onBack }: { entry: MockEntry; onBack: () => void }) {
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const body = entry.body ?? "";
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
              <span>📝 notes</span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span>{wordCount(body)} words</span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span>edited {formatRelativeTime(entry.updatedAt)}</span>
              {entry.published && (<><span className="text-stone-300 dark:text-stone-600">·</span><PublishedDot /></>)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => setMode(mode === "edit" ? "preview" : "edit")} className="rounded-full px-3 py-1.5 text-xs font-semibold bg-stone-100 dark:bg-gray-900 text-stone-700 dark:text-stone-200">
              {mode === "edit" ? "Preview" : "Edit"}
            </button>
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
            <textarea defaultValue={body} className="w-full min-h-[420px] resize-none bg-transparent text-base leading-relaxed text-stone-900 dark:text-stone-100 focus:outline-none font-mono" />
          )}
        </div>
        <div>
          <StaticMenuLegend>more menu (note = list in Notes)</StaticMenuLegend>
          <StaticMenu
            items={[
              { label: "Keyboard shortcuts", icon: "⌨️" },
              { label: "Rename list", icon: "✏️" },
              { label: "Change category", icon: "📁", disabled: true, hint: "notes stay in Notes" },
              { label: "Share link", icon: "🔗" },
              { label: "Publish list", icon: "📡" },
              { label: "Save as template", icon: "🧩", disabled: true, hint: "no items" },
              { label: "Delete list", icon: "🗑️", danger: true },
            ]}
          />
          <p className="mt-2 text-[10px] text-stone-400 max-w-[15rem] leading-snug" style={{ fontFamily: MONO }}>copy says "list" everywhere unless each string checks the folder</p>
        </div>
      </div>
    </div>
  );
}

/** Today's Create List modal; picking the Notes folder flips it into a note form. */
function CreateC({ initialFolder, onClose }: { initialFolder: Folder; onClose: () => void }) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string>(initialFolder === "notes" ? "notes" : initialFolder === "home" || initialFolder === "work" ? initialFolder : "");
  const isNote = folder === "notes";
  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{isNote ? "📝" : "✨"}</span>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isNote ? "Create New Note" : "Create New List"}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{isNote ? "Give your note a title" : "Give your list a name"}</p>
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
        {isNote ? "Create Note" : "Create List"}
      </button>
    </div>
  );
  return (
    <Panel isOpen onClose={onClose} header={header} footer={footer}>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{isNote ? "Note title" : "List name"}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isNote ? "e.g., Garden plan for spring" : "e.g., Groceries, Weekend Tasks"} className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm">
            <option value="">Uncategorized</option>
            <option value="notes">📝 Notes (built-in)</option>
            {MOCK_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ Create new category</option>
          </select>
          {isNote && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 leading-snug">
              Prose only — no items. Once created in Notes it can't be moved to another category or turned into a list.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function VariantC({ entries, openId, setOpen, createKind, setCreate, folder, setFolder }: VariantProps & { folder: Folder; setFolder: (f: Folder) => void }) {
  const [query, setQuery] = useState("");
  const open = entries.find((e) => e.id === openId);
  if (open) {
    return open.kind === "note" ? <NoteHeaderC entry={open} onBack={() => setOpen(null)} /> : <TodaysListHeader entry={open} onBack={() => setOpen(null)} />;
  }

  const q = query.trim().toLowerCase();
  const visible = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
  const count = (f: Folder) => entries.filter((e) => f === "all" || folderOf(e) === f).length;
  const shown = visible.filter((e) => folder === "all" || folderOf(e) === folder).sort((a, b) => b.updatedAt - a.updatedAt);
  const counts = { lists: entries.filter((e) => e.kind === "list").length, notes: entries.filter((e) => e.kind === "note").length, shared: count("shared") };

  const folders: { key: Folder; label: string; builtin?: boolean }[] = [
    { key: "all", label: "All" },
    { key: "notes", label: "📝 Notes", builtin: true },
    ...MOCK_CATEGORIES.map((c) => ({ key: c.id as Folder, label: `📁 ${c.name}` })),
    { key: "uncategorized", label: "Uncategorized" },
    { key: "shared", label: "🤝 Shared" },
  ];

  return (
    <div className="min-h-full pb-28">
      <GreetingHero counts={counts} />
      <div className="flex gap-2.5 mb-3 items-center">
        <div className="flex-1 min-w-0"><SearchInput value={query} onChange={setQuery} className="w-full" /></div>
        <NewPill label="New" onClick={() => setCreate("list")} />
      </div>

      {/* Folder strip — replaces the stacked category sections */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1 -mx-4 px-4">
        {folders.map((f) => {
          const active = folder === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFolder(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors ${
                active ? "text-white" : "text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800/60 hover:bg-stone-200"
              } ${f.builtin && !active ? "border border-dashed border-stone-400 dark:border-stone-500 bg-transparent" : ""}`}
              style={active ? { background: "var(--boop-accent)" } : undefined}
              title={f.builtin ? "Built-in folder: can't be renamed or deleted" : undefined}
            >
              <span>{f.label}</span>
              <span className={active ? "text-white/70" : "text-stone-400"}>{count(f.key)}</span>
            </button>
          );
        })}
        <button type="button" className="inline-flex items-center px-2.5 py-1.5 rounded-full text-[12px] text-stone-400 hover:text-stone-600 whitespace-nowrap" title="Manage categories">+ folder</button>
      </div>

      {folder === "notes" && (
        <p className="mb-4 text-[11px] text-stone-500 dark:text-stone-400" style={{ fontFamily: MONO }}>
          built-in · every note lives here · lists can't be moved in, notes can't be moved out
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-slide-up">
        {shown.map((e) => e.kind === "note"
          ? <NoteCardC key={e.id} entry={e} onOpen={() => setOpen(e.id)} />
          : <ListCardC key={e.id} entry={e} onOpen={() => setOpen(e.id)} />)}
      </div>

      <Fab label="Create new list" onClick={() => setCreate("list")} />
      {createKind && <CreateC initialFolder={folder} onClose={() => setCreate(null)} />}
    </div>
  );
}
