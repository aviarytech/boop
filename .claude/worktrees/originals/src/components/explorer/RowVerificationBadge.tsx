import type { ExplorerVerification } from "../../lib/explorer";

export function RowVerificationBadge({ verification }: { verification: ExplorerVerification }) {
  if (verification === "none") return null;

  const config = {
    verified: { icon: "✓", label: "Verified", color: "text-green-600 dark:text-green-400" },
    anchored: { icon: "⛓", label: "Anchored", color: "text-purple-600 dark:text-purple-400" },
    pending: { icon: "⏳", label: "Pending", color: "text-stone-500 dark:text-stone-400" },
  } as const;

  const { icon, label, color } = config[verification];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}
