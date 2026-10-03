import { useState } from "react";
import type {
  ExplorerFilters,
  ExplorerSource,
  ExplorerLayer,
  ExplorerVerification,
  ExplorerSort,
} from "../../lib/explorer";
import type { ColumnPrefs } from "../../lib/explorerColumns";
import { SearchInput } from "../ui/SearchInput";

interface Props {
  filters: ExplorerFilters;
  searchInput: string;
  onSearch: (q: string) => void;
  onToggleKind: (v: ExplorerSource) => void;
  onToggleLayer: (v: ExplorerLayer) => void;
  onToggleVerify: (v: ExplorerVerification) => void;
  sort: ExplorerSort;
  onSort: (s: ExplorerSort) => void;
  columns: ColumnPrefs;
  onToggleColumn: (k: keyof ColumnPrefs) => void;
}

const KIND_OPTIONS: { value: ExplorerSource; label: string }[] = [
  { value: "list", label: "List" },
  { value: "site", label: "Site" },
];
const LAYER_OPTIONS: { value: ExplorerLayer; label: string }[] = [
  { value: "did:cel", label: "cel" },
  { value: "did:webvh", label: "webvh" },
  { value: "did:btco", label: "btco" },
];
const VERIFY_OPTIONS: { value: ExplorerVerification; label: string }[] = [
  { value: "verified", label: "Verified" },
  { value: "anchored", label: "Anchored" },
  { value: "pending", label: "Pending" },
];

const COLUMN_LABELS: Record<keyof ColumnPrefs, string> = {
  identifier: "Identifier",
  collaborators: "Collaborators",
  anchorTxidPrefix: "Anchor txid",
};

function Chip<T extends string>({
  group, value, label, active, onToggle,
}: { group: string; value: T; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-chip={`${group}:${value}`}
      aria-pressed={active}
      onClick={onToggle}
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "bg-amber-500 text-white"
          : "bg-stone-100 dark:bg-gray-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-gray-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function ExplorerToolbar(props: Props) {
  const [columnsOpen, setColumnsOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex-1">
          <SearchInput
            value={props.searchInput}
            onChange={props.onSearch}
            placeholder="Search originals…"
          />
        </div>
        <select
          value={`${props.sort.key}:${props.sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(":") as [ExplorerSort["key"], ExplorerSort["dir"]];
            props.onSort({ key, dir });
          }}
          className="rounded-xl bg-stone-100 dark:bg-gray-800 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200"
        >
          <option value="updated:desc">Updated (newest first)</option>
          <option value="created:desc">Created (newest first)</option>
          <option value="title:asc">Title A–Z</option>
        </select>
        <div className="relative">
          <button
            type="button"
            data-columns-trigger
            onClick={() => setColumnsOpen((v) => !v)}
            className="rounded-xl bg-stone-100 dark:bg-gray-800 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200"
          >
            Columns ⌄
          </button>
          {columnsOpen && (
            <div className="absolute right-0 z-10 mt-1 rounded-xl border border-stone-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-2 w-48">
              {(Object.keys(COLUMN_LABELS) as (keyof ColumnPrefs)[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  data-column-toggle={key}
                  onClick={() => props.onToggleColumn(key)}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-gray-800 rounded"
                >
                  <span>{COLUMN_LABELS[key]}</span>
                  <span aria-hidden="true">{props.columns[key] ? "✓" : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center text-[11px] uppercase tracking-wide text-stone-400">
        <span>Kind:</span>
        {KIND_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            group="kind"
            value={o.value}
            label={o.label}
            active={props.filters.kind.includes(o.value)}
            onToggle={() => props.onToggleKind(o.value)}
          />
        ))}
        <span className="ml-3">Layer:</span>
        {LAYER_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            group="layer"
            value={o.value}
            label={o.label}
            active={props.filters.layer.includes(o.value)}
            onToggle={() => props.onToggleLayer(o.value)}
          />
        ))}
        <span className="ml-3">Verification:</span>
        {VERIFY_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            group="verify"
            value={o.value}
            label={o.label}
            active={props.filters.verify.includes(o.value)}
            onToggle={() => props.onToggleVerify(o.value)}
          />
        ))}
      </div>
    </div>
  );
}
