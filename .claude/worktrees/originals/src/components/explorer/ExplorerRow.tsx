import { Link } from "react-router-dom";
import type { ExplorerRow as ExplorerRowType } from "../../lib/explorer";
import type { ColumnPrefs } from "../../lib/explorerColumns";
import { KindBadge } from "./KindBadge";
import { LayerBadge } from "./LayerBadge";
import { RowVerificationBadge } from "./RowVerificationBadge";

interface Props {
  row: ExplorerRowType;
  columns: ColumnPrefs;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

function destinationFor(row: ExplorerRowType): string {
  return row.source === "list" ? `/list/${row.sourceId}` : `/s/${row.sourceId}`;
}

export function ExplorerRow({ row, columns }: Props) {
  const Icon = row.source === "list" ? "📝" : "🌐";

  return (
    <Link
      to={destinationFor(row)}
      data-row-id={row.id}
      className="grid grid-cols-[24px_1fr_auto_auto] md:grid-cols-[24px_1fr_auto_auto_auto_auto_auto] gap-3 items-center px-4 py-3 border-b border-stone-100 dark:border-gray-800 hover:bg-stone-50 dark:hover:bg-gray-900/50 transition-colors"
    >
      <span aria-hidden="true" className="text-base">
        {Icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">
          {row.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <KindBadge kind={row.source} />
          <LayerBadge layer={row.layer} />
        </div>
      </div>
      <div className="text-xs">
        <RowVerificationBadge verification={row.verification} />
      </div>
      <div className="text-[11px] text-stone-400 dark:text-stone-500 whitespace-nowrap">
        {relativeTime(row.updatedAt)}
      </div>

      {columns.identifier && (
        <div data-column="identifier" className="hidden md:block text-[11px] font-mono text-stone-500 truncate">
          {row.identifier ?? ""}
        </div>
      )}
      {columns.collaborators && (
        <div data-column="collaborators" className="hidden md:block text-[11px] text-stone-500">
          {row.collaborators ?? 0}
        </div>
      )}
      {columns.anchorTxidPrefix && (
        <div data-column="anchorTxidPrefix" className="hidden md:block text-[11px] font-mono text-stone-500">
          {row.verification === "anchored" && row.anchorTxId
            ? row.anchorTxId.slice(0, 8)
            : ""}
        </div>
      )}
    </Link>
  );
}
