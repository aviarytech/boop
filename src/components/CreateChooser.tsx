/**
 * First step of "New": pick a list or a note. A note is born a note, so the
 * kind is chosen before anything is named.
 */

import { Panel } from "./ui/Panel";
import { useSettings } from "../hooks/useSettings";
import { Icon } from "./ui/Icon";

export type CreateKind = "list" | "note";

const OPTIONS: { kind: CreateKind; icon: "list" | "file"; title: string; blurb: string }[] = [
  { kind: "list", icon: "list", title: "List", blurb: "Items you check off. Share, categorize, save as a template." },
  { kind: "note", icon: "file", title: "Note", blurb: "Prose you sign. Publish it and readers can verify who wrote it and that it hasn't changed." },
];

interface CreateChooserProps {
  onPick: (kind: CreateKind) => void;
  onClose: () => void;
}

export function CreateChooser({ onPick, onClose }: CreateChooserProps) {
  const { haptic } = useSettings();

  const header = (
    <>
      <div className="flex items-center gap-3">
        <div>
          <h2 id="create-chooser-title" className="text-lg font-bold text-[var(--boop-ink)]">
            Create new
          </h2>
          <p className="text-xs text-[var(--boop-muted)]">What are you making?</p>
        </div>
      </div>
      <button
        onClick={() => { haptic('light'); onClose(); }}
        className="p-2 text-[var(--boop-dim)] hover:text-[var(--boop-muted)] rounded-lg hover:bg-[color-mix(in_oklch,var(--boop-ink)_7%,var(--boop-panel))] transition-colors"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  return (
    <Panel isOpen onClose={onClose} header={header} ariaLabelledBy="create-chooser-title">
      <div className="p-5 grid grid-cols-2 gap-3">
        {OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => { haptic('light'); onPick(option.kind); }}
            className="text-left rounded-2xl border-2 border-[var(--boop-line)] hover:border-[var(--boop-accent)] p-4 transition-colors bg-[var(--boop-panel)]"
          >
            <span className="flex items-center justify-center w-9 h-9 mb-3 rounded-xl bg-[var(--boop-accent-soft)] text-[var(--boop-accent-ink)]"><Icon name={option.icon} className="w-[18px] h-[18px]" /></span>
            <div className="font-bold text-[var(--boop-ink)]" style={{ fontFamily: 'var(--font-sans)' }}>{option.title}</div>
            <div className="text-xs text-[var(--boop-muted)] mt-1 leading-snug">{option.blurb}</div>
          </button>
        ))}
        <p className="col-span-2 text-[11px] text-[var(--boop-dim)]" style={{ fontFamily: 'var(--font-mono)' }}>
          a note is born a note — it can't be turned into a list later
        </p>
      </div>
    </Panel>
  );
}
