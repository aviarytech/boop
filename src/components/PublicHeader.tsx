import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The header on boop's public pages (pricing, docs, templates, compare,
 * legal). It follows the landing nav: the wordmark on the left and the
 * page's actions on the right. Landing keeps its own nav.
 */
export function PublicHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--boop-line)] bg-[color-mix(in_oklch,var(--boop-bg)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" className="boop-wordmark text-[24px] no-underline hover:opacity-80 transition-opacity">
          <span className="boop-dot" aria-hidden="true" />
          boop
        </Link>
        {children && <div className="flex items-center gap-5 text-[15px]">{children}</div>}
      </div>
    </header>
  );
}

/** A quiet text action in the public header ("Sign in", "My templates"). */
export const publicNavLink =
  "font-semibold text-[var(--boop-ink)] no-underline hover:underline underline-offset-4";

/** The one jade action in the public header ("Get boop"). */
export const publicNavButton =
  "inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-[15px] font-semibold text-white no-underline whitespace-nowrap hover:bg-amber-600 transition-colors";
