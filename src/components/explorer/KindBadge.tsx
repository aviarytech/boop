import type { ExplorerSource } from "../../lib/explorer";

export function KindBadge({ kind }: { kind: ExplorerSource }) {
  const styles =
    kind === "list"
      ? "bg-[var(--boop-accent-soft)] text-[var(--boop-accent-ink)]"
      : "bg-[var(--boop-panel)] text-[var(--boop-ink)] shadow-[inset_0_0_0_1px_var(--boop-line)]";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${styles}`}>
      {kind === "site" ? "page" : kind}
    </span>
  );
}
