import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  decodeFiltersFromParams,
  encodeFiltersToParams,
  type ExplorerFilters,
  type ExplorerSource,
  type ExplorerLayer,
  type ExplorerVerification,
  type ExplorerSort,
} from "../lib/explorer";
import {
  loadColumnPrefs,
  saveColumnPrefs,
  type ColumnPrefs,
} from "../lib/explorerColumns";

const DEFAULT_SORT: ExplorerSort = { key: "updated", dir: "desc" };
const DEFAULT_DEBOUNCE_MS = 250;

export interface UseExplorerFiltersOptions {
  debounceMs?: number;
}

export function useExplorerFilters(opts: UseExplorerFiltersOptions = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const filters: ExplorerFilters = useMemo(
    () => decodeFiltersFromParams(searchParams),
    [searchParams],
  );

  // Ephemeral search input — tracks keystrokes before the debounce fires.
  // We store the in-flight value as state and track the last-seen URL q in
  // state too, so we can reset without a useEffect call.
  const [searchInput, setSearchInput] = useState(filters.q);
  const [prevUrlQ, setPrevUrlQ] = useState(filters.q);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Idiomatic derived-state reset: when the URL's q changes (e.g. back-button),
  // synchronously reset the input to match. This is the pattern React docs
  // recommend instead of useEffect for "getDerivedStateFromProps"-style logic.
  if (filters.q !== prevUrlQ) {
    setPrevUrlQ(filters.q);
    setSearchInput(filters.q);
  }

  const writeFilters = useCallback(
    (next: ExplorerFilters, options: { replace?: boolean } = {}) => {
      setSearchParams(encodeFiltersToParams(next), { replace: options.replace });
    },
    [setSearchParams],
  );

  const setSearchQuery = useCallback(
    (q: string) => {
      setSearchInput(q);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        writeFilters({ ...filters, q }, { replace: true });
      }, debounceMs);
    },
    [filters, writeFilters, debounceMs],
  );

  const toggleArrayChip = useCallback(
    <T extends string>(key: "kind" | "layer" | "verify", value: T) => {
      const current = filters[key] as T[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      writeFilters({ ...filters, [key]: next });
    },
    [filters, writeFilters],
  );

  const toggleKindChip = useCallback(
    (v: ExplorerSource) => toggleArrayChip("kind", v),
    [toggleArrayChip],
  );
  const toggleLayerChip = useCallback(
    (v: ExplorerLayer) => toggleArrayChip("layer", v),
    [toggleArrayChip],
  );
  const toggleVerifyChip = useCallback(
    (v: ExplorerVerification) => toggleArrayChip("verify", v),
    [toggleArrayChip],
  );

  // Sort lives in URL too (key + dir). Default if unset.
  const sort: ExplorerSort = useMemo(() => {
    const key = (searchParams.get("sort") as ExplorerSort["key"] | null) ?? DEFAULT_SORT.key;
    const dir = (searchParams.get("dir") as ExplorerSort["dir"] | null) ?? DEFAULT_SORT.dir;
    return { key, dir };
  }, [searchParams]);

  const setSort = useCallback(
    (next: ExplorerSort) => {
      const params = encodeFiltersToParams(filters);
      params.set("sort", next.key);
      params.set("dir", next.dir);
      setSearchParams(params);
    },
    [filters, setSearchParams],
  );

  // Columns: localStorage-backed via explorerColumns.ts.
  const [columns, setColumns] = useState<ColumnPrefs>(() => loadColumnPrefs());

  const toggleColumn = useCallback(
    (key: keyof ColumnPrefs) => {
      const next = { ...columns, [key]: !columns[key] };
      saveColumnPrefs(next);
      setColumns(next);
    },
    [columns],
  );

  return {
    filters,
    searchInput,
    setSearchQuery,
    toggleKindChip,
    toggleLayerChip,
    toggleVerifyChip,
    sort,
    setSort,
    columns,
    toggleColumn,
  };
}
