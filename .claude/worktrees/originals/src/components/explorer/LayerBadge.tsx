import type { ExplorerLayer } from "../../lib/explorer";

export function LayerBadge({ layer }: { layer: ExplorerLayer }) {
  return (
    <span className="text-[10px] font-mono text-stone-500 dark:text-stone-400">
      {layer}
    </span>
  );
}
