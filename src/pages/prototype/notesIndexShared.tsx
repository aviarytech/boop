/* eslint-disable react-refresh/only-export-components -- prototype */
/**
 * PROTOTYPE — throwaway. Pieces shared by the /prototype/notes-index variants:
 * a mock-props copy of ListCard, the current list header (for comparison),
 * a markdown preview, and small header controls copied from ListView.
 */

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LegacyBadge } from "../../components/LegacyBadge";
import { ItemVerificationBadge, ListVerificationBadge } from "../../components/VerificationBadge";
import { ME, formatRelativeTime, truncateDid, type MockEntry } from "./notesIndexMock";

export const NUNITO = "Nunito, system-ui, sans-serif";
export const MONO = "Geist Mono, ui-monospace, monospace";

export function tagLine(entry: MockEntry, showOwner?: boolean): string[] {
  const isOwner = entry.ownerDid === ME;
  const parts: string[] = [];
  if (showOwner && !isOwner) parts.push(truncateDid(entry.ownerDid));
  else if (!isOwner) parts.push("shared");
  else parts.push("personal");
  parts.push(formatRelativeTime(entry.createdAt));
  return parts;
}

/** Green "shared" dot from the list header meta line. */
export function PublishedDot({ label = "shared" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1a7a4c", display: "inline-block" }} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Today's ListCard, verbatim styling, fed from mock props instead of Convex.
 * Verification chip added so provenance cues sit next to note cards.
 */
export function MockListCard({ entry, showOwner, onOpen, prefix }: { entry: MockEntry; showOwner?: boolean; onOpen: () => void; prefix?: string }) {
  const total = entry.items?.total ?? 0;
  const done = entry.items?.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left relative overflow-hidden bg-white dark:bg-stone-800/70 rounded-[18px] p-[18px] border border-stone-200/70 dark:border-stone-700/50 hover:border-amber-300/60 dark:hover:border-amber-700/50 hover:-translate-y-[1px] transition-all duration-150 active:scale-[0.99]"
      aria-label={`Open list: ${entry.name}`}
    >
      <div className="relative flex justify-between items-start mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-stone-500 dark:text-stone-400 lowercase" style={{ fontFamily: MONO }}>
            <span className="truncate">{[...(prefix ? [prefix] : []), ...tagLine(entry, showOwner)].join(" · ")}</span>
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
      <div className="relative flex items-center gap-2.5">
        <div className="flex-1 h-[4px] rounded-full overflow-hidden bg-stone-200/70 dark:bg-stone-700/60">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--boop-accent)" }} />
        </div>
        <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums" style={{ fontFamily: MONO }}>
          {done}/{total}
        </span>
      </div>
    </button>
  );
}

/** Rendered markdown with a hand-rolled prose style (no typography plugin in this app). */
export function MarkdownPreview({ body }: { body: string }) {
  return (
    <div className="proto-prose text-stone-800 dark:text-stone-200 text-[16px] leading-relaxed max-w-[68ch]">
      <style>{`
        .proto-prose h1 { font-family: ${NUNITO}; font-weight: 800; font-size: 28px; letter-spacing: -0.6px; line-height: 1.1; margin: 0 0 16px; }
        .proto-prose h2 { font-family: ${NUNITO}; font-weight: 700; font-size: 19px; letter-spacing: -0.3px; margin: 24px 0 8px; }
        .proto-prose p { margin: 0 0 12px; }
        .proto-prose ul, .proto-prose ol { margin: 0 0 12px 22px; }
        .proto-prose ul { list-style: disc; } .proto-prose ol { list-style: decimal; }
        .proto-prose li { margin: 2px 0; }
        .proto-prose blockquote { border-left: 3px solid var(--boop-accent); padding-left: 12px; color: var(--boop-muted); margin: 12px 0; }
        .proto-prose code { font-family: ${MONO}; font-size: 0.9em; background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 4px; }
        .proto-prose strong { font-weight: 700; }
      `}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header controls, copied from ListView so the note headers can reuse them.

export function BackButton({ onClick, label = "Back to lists" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
      aria-label={label}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

export function RoundIconButton({ label, children, active }: { label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center p-2 rounded-full transition-all active:scale-95 ${
        active
          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700"
          : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function ShareIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

/** The pill segmented control from the list header (A-Z / grouped / calendar). */
export function SegmentedPill({ options, value }: { options: { key: string; label: string; icon: ReactNode }[]; value: string }) {
  return (
    <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full transition-all active:scale-95 ${
            value === o.key ? "bg-white dark:bg-gray-600 text-amber-600 dark:text-amber-400 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
          aria-label={o.label}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

const listViewIcons = [
  { key: "alpha", label: "Alphabetical view", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg> },
  { key: "cat", label: "Categorized view", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg> },
  { key: "calendar", label: "Calendar view", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
];

export function StaticMenuLegend({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-1.5" style={{ fontFamily: MONO }}>{children}</div>;
}

/** A static menu for the "more" button — renders open so the options are visible in a screenshot. */
export function StaticMenu({ items }: { items: { label: string; icon: string; disabled?: boolean; hint?: string; danger?: boolean }[] }) {
  return (
    <div className="w-60 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-2">
      {items.map((it) => (
        <div
          key={it.label}
          className={`px-4 py-2.5 text-sm flex items-center gap-3 ${
            it.disabled ? "text-gray-400 dark:text-gray-500" : it.danger ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-200"
          }`}
        >
          <span className="text-base leading-none">{it.icon}</span>
          <span className={it.disabled ? "line-through decoration-gray-300" : ""}>{it.label}</span>
          {it.hint && <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 text-right leading-tight max-w-[8rem]">{it.hint}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Today's list header (ListView.tsx) with mock data. Shown when a list is
 * opened in any variant, so the note header can be judged against it.
 */
export function TodaysListHeader({ entry, onBack }: { entry: MockEntry; onBack: () => void }) {
  const total = entry.items?.total ?? 0;
  const done = entry.items?.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
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
            <div className="flex items-center gap-2 text-[12px] mt-1 text-stone-500 dark:text-stone-400" style={{ fontFamily: MONO }}>
              {total > 0 && <span>{done}/{total} done</span>}
              {entry.published && (<><span className="text-stone-300 dark:text-stone-600">·</span><PublishedDot /></>)}
            </div>
            {total > 0 && (
              <div className="flex items-center gap-2.5 mt-3 max-w-md">
                <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-stone-200/70 dark:bg-stone-700/60">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--boop-accent)" }} />
                </div>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--boop-accent)", fontFamily: MONO }}>{pct}%</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <SegmentedPill options={listViewIcons} value="alpha" />
            <RoundIconButton label="Add to favourites"><span className="text-sm leading-none">☆</span></RoundIconButton>
            <RoundIconButton label="Share"><ShareIcon /></RoundIconButton>
            <RoundIconButton label="More actions"><MoreIcon /></RoundIconButton>
          </div>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-4 bg-amber-100 dark:bg-amber-900/30 rounded-full h-2.5 overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px] bg-white dark:bg-gray-800 rounded-2xl border border-stone-200/70 dark:border-stone-700/50 divide-y divide-stone-100 dark:divide-stone-700/60">
          {Array.from({ length: Math.min(total, 5) }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 text-sm text-stone-700 dark:text-stone-200">
              <span className={`w-5 h-5 rounded-md border-2 flex-shrink-0 ${i < done ? "bg-amber-500 border-amber-500" : "border-stone-300 dark:border-stone-600"}`} />
              <span className={i < done ? "line-through text-stone-400" : ""}>Item {i + 1}</span>
            </div>
          ))}
          {total > 5 && <div className="px-4 py-2 text-xs text-stone-400" style={{ fontFamily: MONO }}>+{total - 5} more</div>}
        </div>
        <div>
          <StaticMenuLegend>more menu (today)</StaticMenuLegend>
          <StaticMenu
            items={[
              { label: "Keyboard shortcuts", icon: "⌨️" },
              { label: "Rename list", icon: "✏️" },
              { label: "Change category", icon: "📁" },
              { label: "Share link", icon: "🔗" },
              { label: "Publish list", icon: "📡" },
              { label: "Save as template", icon: "🧩" },
              { label: "Delete list", icon: "🗑️", danger: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Copy of the Home greeting hero, with counts split by kind. */
export function GreetingHero({ counts, subtitle }: { counts: { lists: number; notes: number; shared: number }; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 pt-2 pb-5">
      <div className="flex-1 min-w-0">
        <h1 className="text-stone-900 dark:text-stone-50" style={{ fontFamily: NUNITO, fontWeight: 700, fontSize: "clamp(30px, 5.5vw, 40px)", letterSpacing: -1.2, lineHeight: 1.05, margin: 0 }}>
          {subtitle ?? (<>Your lists —<br /><span className="text-stone-500 dark:text-stone-400" style={{ fontWeight: 600 }}>what's on today?</span></>)}
        </h1>
        <div className="flex items-center gap-3.5 flex-wrap mt-3 text-[13px] text-stone-500 dark:text-stone-400">
          <span><b className="text-stone-900 dark:text-stone-100">{counts.lists}</b> lists</span>
          <span className="text-stone-300 dark:text-stone-600">·</span>
          <span><b className="text-stone-900 dark:text-stone-100">{counts.notes}</b> notes</span>
          {counts.shared > 0 && (<><span className="text-stone-300 dark:text-stone-600">·</span><span><b className="text-stone-900 dark:text-stone-100">{counts.shared}</b> shared</span></>)}
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className="flex items-center justify-center w-[34px] h-[34px] rounded-full text-white font-extrabold text-sm" style={{ background: "var(--boop-accent)", fontFamily: NUNITO, letterSpacing: -0.3 }}>B</span>
      </div>
    </div>
  );
}

/** The accent "New" pill from Home's search row. */
export function NewPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold text-white active:scale-95 transition-transform whitespace-nowrap"
      style={{ background: "var(--boop-accent)", boxShadow: "0 4px 14px rgba(107,60,255,0.3)" }}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      <span>{label}</span>
    </button>
  );
}

export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-20 right-6 z-30 w-14 h-14 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white rounded-2xl shadow-lg shadow-amber-500/30 transition-all active:scale-90 flex items-center justify-center group"
      aria-label={label}
      title={label}
    >
      <svg className="w-6 h-6 transition-transform duration-200 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
    </button>
  );
}

export function SecondaryChip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
        active ? "text-white" : "text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800/60 hover:bg-stone-200 dark:hover:bg-stone-800"
      }`}
      style={active ? { background: "var(--boop-accent)" } : undefined}
    >
      {children}
    </button>
  );
}
