/**
 * First step of "New": pick a list or a note. A note is born a note, so the
 * kind is chosen before anything is named.
 */

import { Panel } from "./ui/Panel";
import { useSettings } from "../hooks/useSettings";

export type CreateKind = "list" | "note";

const OPTIONS: { kind: CreateKind; icon: string; title: string; blurb: string }[] = [
  { kind: "list", icon: "☑", title: "List", blurb: "Items you check off. Share, categorize, save as a template." },
  { kind: "note", icon: "¶", title: "Note", blurb: "Prose you sign. Publish it and readers can verify who wrote it and that it hasn't changed." },
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
        <span className="text-2xl leading-none">✨</span>
        <div>
          <h2 id="create-chooser-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Create new
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">What are you making?</p>
        </div>
      </div>
      <button
        onClick={() => { haptic('light'); onClose(); }}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
            className="text-left rounded-2xl border-2 border-stone-200 dark:border-stone-700 hover:border-amber-400 dark:hover:border-amber-500 p-4 transition-colors bg-stone-50 dark:bg-gray-900"
          >
            <div className="text-2xl mb-2" style={{ fontFamily: 'Nunito, system-ui, sans-serif' }} aria-hidden="true">{option.icon}</div>
            <div className="font-bold text-stone-900 dark:text-stone-100" style={{ fontFamily: 'Nunito, system-ui, sans-serif' }}>{option.title}</div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-snug">{option.blurb}</div>
          </button>
        ))}
        <p className="col-span-2 text-[11px] text-stone-400" style={{ fontFamily: 'Geist Mono, ui-monospace, monospace' }}>
          a note is born a note — it can't be turned into a list later
        </p>
      </div>
    </Panel>
  );
}
