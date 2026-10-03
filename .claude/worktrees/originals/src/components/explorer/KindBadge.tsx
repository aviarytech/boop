import type { ExplorerSource } from "../../lib/explorer";

export function KindBadge({ kind }: { kind: ExplorerSource }) {
  const styles =
    kind === "list"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${styles}`}>
      {kind}
    </span>
  );
}
