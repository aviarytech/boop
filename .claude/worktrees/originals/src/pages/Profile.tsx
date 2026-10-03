/**
 * User profile page with stats and account details.
 * Displays user identity, activity statistics, and account information.
 */

import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { useBilling } from "../hooks/useBilling";

export function Profile() {
  const { did, legacyDid, email, displayName, isLoading: userLoading, subOrgId } = useCurrentUser();
  const { haptic } = useSettings();
  const { plan, subscription } = useBilling();

  // Fetch user's lists
  const lists = useQuery(
    api.lists.getUserLists,
    did ? { userDid: did, legacyDid: legacyDid ?? undefined } : "skip"
  );

  // Fetch user stats
  const stats = useQuery(
    api.users.getUserStats,
    did ? { userDid: did, legacyDid: legacyDid ?? undefined } : "skip"
  );

  // Referral info
  const convexUser = useQuery(
    api.auth.getUserByTurnkeyId,
    subOrgId ? { turnkeySubOrgId: subOrgId } : "skip"
  );
  const referralStats = useQuery(
    api.referrals.getReferralStats,
    convexUser?._id ? { userId: convexUser._id } : "skip"
  );

  if (userLoading || !did) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="flex-1">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-gray-100 dark:bg-gray-700 rounded-xl p-4">
                <div className="h-8 bg-gray-200 dark:bg-gray-600 rounded w-12 mb-2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const totalLists = lists?.length ?? 0;
  const ownedLists = lists?.filter(l => l.ownerDid === did || l.ownerDid === legacyDid).length ?? 0;
  const sharedLists = totalLists - ownedLists;
  const totalItems = stats?.totalItems ?? 0;
  const completedItems = stats?.completedItems ?? 0;
  const completionRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  // Format DID for display
  const shortDid = did.length > 24 
    ? `${did.slice(0, 12)}...${did.slice(-8)}`
    : did;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back button */}
      <Link
        to="/d"
        onClick={() => haptic('light')}
        className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to lists
      </Link>

      {/* Profile Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
        {/* Header with avatar */}
        <div className="px-6 py-8 text-center" style={{ background: 'var(--boop-accent)' }}>
          <div
            className="w-20 h-20 mx-auto rounded-full flex items-center justify-center text-white shadow-lg mb-4"
            style={{
              background: 'rgba(255,255,255,0.15)',
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: -1,
            }}
            aria-hidden="true"
          >
            {(displayName || email || 'B').trim().charAt(0).toUpperCase()}
          </div>
          <h1
            className="text-white mb-1"
            style={{
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: -0.5,
            }}
          >
            {displayName || email?.split('@')[0] || 'Anonymous'}
          </h1>
          <p className="text-white/75 text-sm">
            {email || 'No email set'}
          </p>
        </div>

        {/* DID Section */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Your DID
              </p>
              <p className="font-mono text-sm text-gray-700 dark:text-gray-300" title={did}>
                {shortDid}
              </p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(did);
                haptic('success');
              }}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Copy DID to clipboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span>📊</span> Your Stats
          </h2>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {ownedLists}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Lists Created
              </p>
            </div>
            
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {sharedLists}
              </p>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Shared Lists
              </p>
            </div>
            
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                {completedItems}
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                Items Done
              </p>
            </div>
            
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center border border-amber-200 dark:border-amber-800">
              <p className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                {completionRate}%
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                Completion Rate
              </p>
            </div>
          </div>
        </div>

        {/* Activity Summary */}
        <div className="px-6 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span>🎯</span> Activity Summary
          </h2>
          
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">Overall Progress</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {completedItems} / {totalItems} items
                </span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>

            {/* Quick facts */}
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-lg">📝</span>
                  <span>
                    You have <strong className="text-gray-900 dark:text-gray-100">{totalItems}</strong> total items across all lists
                  </span>
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-lg">✅</span>
                  <span>
                    <strong className="text-gray-900 dark:text-gray-100">{completedItems}</strong> items completed
                  </span>
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-lg">⏳</span>
                  <span>
                    <strong className="text-gray-900 dark:text-gray-100">{totalItems - completedItems}</strong> items remaining
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Subscription / Plan section */}
        <div className="px-6 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span>💳</span> Plan
          </h2>
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100 capitalize">{plan}</p>
              {subscription?.currentPeriodEnd && plan !== "free" && !referralStats?.referralProUntil && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
              {referralStats?.referralProUntil && referralStats.referralProUntil > Date.now() && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Referral Pro — expires{" "}
                  {new Date(referralStats.referralProUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </p>
              )}
              {referralStats?.totalReferrals != null && referralStats.totalReferrals > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {referralStats.totalReferrals} friend{referralStats.totalReferrals === 1 ? "" : "s"} referred
                </p>
              )}
            </div>
            {plan === "free" ? (
              <Link
                to="/pricing"
                onClick={() => haptic('light')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Upgrade →
              </Link>
            ) : (
              <Link
                to="/pricing"
                onClick={() => haptic('light')}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors"
              >
                Manage
              </Link>
            )}
          </div>
        </div>

        {/* Motivational footer */}
        {completionRate >= 80 && (
          <div className="px-6 pb-6">
            <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">🏆</p>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Amazing! You're a productivity champion!
              </p>
            </div>
          </div>
        )}
        
        {completionRate < 80 && completionRate >= 50 && (
          <div className="px-6 pb-6">
            <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">💪</p>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Great progress! Keep up the momentum!
              </p>
            </div>
          </div>
        )}
        
        {completionRate < 50 && totalItems > 0 && (
          <div className="px-6 pb-6">
            <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">🚀</p>
              <p className="font-medium text-orange-800 dark:text-orange-200">
                You've got this! Every item counts!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
