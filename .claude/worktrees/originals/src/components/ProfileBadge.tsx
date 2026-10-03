/**
 * ProfileBadge component showing user identity and logout.
 * Features improved design and dark mode support.
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useSettings } from '../hooks/useSettings';
import { useBilling } from '../hooks/useBilling';

const PLAN_LABELS: Record<string, { label: string; className: string }> = {
  pro: { label: "Pro", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  team: { label: "Team", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" },
};

export function ProfileBadge() {
  const { logout } = useAuth();
  const { did, displayName, email } = useCurrentUser();
  const { haptic } = useSettings();
  const { plan } = useBilling();

  if (!did) return null;

  const planBadge = PLAN_LABELS[plan] ?? null;

  // Prefer name → email → DID for the visible label.
  const label = displayName?.trim() || email || (did.length > 16 ? `${did.slice(0, 8)}…${did.slice(-4)}` : did);
  const isMono = !displayName && !email;

  return (
    <div className="flex items-center gap-2">
      {/* Identity badge — links to profile, shows name/email (DID on hover). */}
      <Link
        to="/profile"
        onClick={() => haptic('light')}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-stone-100 dark:bg-gray-800 hover:bg-stone-200 dark:hover:bg-gray-700 rounded-full transition-colors max-w-[14rem]"
        title={did}
      >
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-none" />
        <span className={`text-xs ${isMono ? 'font-mono' : 'font-medium'} text-stone-700 dark:text-gray-300 truncate`}>
          {label}
        </span>
        {planBadge && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex-none ${planBadge.className}`}>
            {planBadge.label}
          </span>
        )}
      </Link>

      {/* Pricing link (only shown for free users) */}
      {plan === "free" && (
        <Link
          to="/pricing"
          onClick={() => haptic('light')}
          className="hidden sm:flex items-center px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-full transition-colors border border-amber-200 dark:border-amber-800"
        >
          Upgrade
        </Link>
      )}

      {/* Logout button */}
      <button
        onClick={() => {
          haptic('medium');
          logout();
        }}
        className="p-2.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
        title="Sign out"
        aria-label="Sign out"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
}
