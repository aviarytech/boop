import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useOffline } from "../hooks/useOffline";
import { useExplorerFilters } from "../hooks/useExplorerFilters";
import { ExplorerToolbar } from "../components/explorer/ExplorerToolbar";
import { ExplorerRow } from "../components/explorer/ExplorerRow";
import { applyExplorerFilters, compareExplorerRows } from "../lib/explorer";
import { Skeleton } from "../components/ui/Skeleton";
import { NoSearchResultsEmptyState } from "../components/ui/EmptyState";
import { Link } from "react-router-dom";

export function Explorer() {
  const { did, isLoading } = useCurrentUser();
  const { isOnline } = useOffline();
  const {
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
  } = useExplorerFilters();

  const data = useQuery(
    api.originals.listOwnedOriginals,
    did ? { ownerDid: did } : "skip",
  );

  const filteredSorted = useMemo(() => {
    if (!data) return null;
    const filtered = applyExplorerFilters(data, filters);
    return filtered.slice().sort(compareExplorerRows(sort));
  }, [data, filters, sort]);

  if (isLoading || !did) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1
          className="text-stone-900 dark:text-stone-50"
          style={{
            fontFamily: "Nunito, system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "clamp(28px, 5vw, 36px)",
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          Originals
        </h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Everything you've signed into existence.
        </p>
      </header>

      {!isOnline && (
        <div className="rounded-xl border border-stone-200 dark:border-gray-800 bg-stone-50 dark:bg-gray-900 px-3 py-2 text-xs text-stone-500">
          You're offline. The Explorer needs a connection.
        </div>
      )}

      <ExplorerToolbar
        filters={filters}
        searchInput={searchInput}
        onSearch={setSearchQuery}
        onToggleKind={toggleKindChip}
        onToggleLayer={toggleLayerChip}
        onToggleVerify={toggleVerifyChip}
        sort={sort}
        onSort={setSort}
        columns={columns}
        onToggleColumn={toggleColumn}
      />

      <section>
        {filteredSorted === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : data && data.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-stone-500 dark:text-stone-400">
              No originals yet — create a list or publish a site to get started.
            </p>
            <div className="flex justify-center gap-3">
              <Link
                to="/d"
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white"
              >
                Create a list →
              </Link>
              <Link
                to="/s"
                className="rounded-xl border border-stone-200 dark:border-gray-800 px-4 py-2 text-xs font-bold text-stone-700 dark:text-stone-200"
              >
                Publish a site →
              </Link>
            </div>
          </div>
        ) : filteredSorted.length === 0 ? (
          <NoSearchResultsEmptyState query={filters.q} />
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            {filteredSorted.map((row) => (
              <ExplorerRow key={row.id} row={row} columns={columns} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
