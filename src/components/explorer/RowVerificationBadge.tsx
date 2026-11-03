import type { ExplorerVerification } from "../../lib/explorer";
import { Icon } from "../ui/Icon";

export function RowVerificationBadge({ verification }: { verification: ExplorerVerification }) {
  if (verification === "none") return null;

  const config = {
    verified: { icon: "checkCircle", label: "Verified", color: "text-[var(--boop-accent)]" },
    anchored: { icon: "link", label: "Anchored", color: "text-[var(--boop-accent-ink)]" },
    pending: { icon: "clock", label: "Pending", color: "text-[var(--boop-dim)]" },
  } as const;

  const { icon, label, color } = config[verification];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon name={icon} className="w-3.5 h-3.5" />
      <span>{label}</span>
    </span>
  );
}
