/**
 * User profile page with stats and account details.
 * Displays user identity, activity statistics, and account information.
 */

import { PublicDisplayNameEditor } from "../components/PublicDisplayNameEditor";
import { Link } from "react-router-dom";
import { useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { useBilling } from "../hooks/useBilling";
import { isNote } from "../../convex/lib/noteBody";
import { Icon } from "../components/ui/Icon";

export function Profile() {
  const { did, legacyDid, email, displayName, isLoading: userLoading, subOrgId } = useCurrentUser();
  const { haptic } = useSettings();
  const { plan, subscription } = useBilling();

  const publicProfile = useQuery(api.users.getMyPublicDisplayName, {});

  // Fetch user's lists
  const lists = useQuery(
    api.lists.getUserLists,
    did ? {} : "skip"
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
        <div className="boop-sheet p-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-20 h-20 bg-[var(--boop-panel)] rounded-full" />
            <div className="flex-1">
              <div className="h-6 bg-[var(--boop-panel)] rounded w-32 mb-2" />
              <div className="h-4 bg-[var(--boop-panel)] rounded w-48" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-[var(--boop-panel)] rounded-xl p-4">
                <div className="h-8 bg-[var(--boop-panel)] rounded w-12 mb-2" />
                <div className="h-4 bg-[var(--boop-panel)] rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const listsOnly = lists?.filter(l => !isNote(l));
  const totalLists = listsOnly?.length ?? 0;
  const ownedLists = listsOnly?.filter(l => l.ownerDid === did || l.ownerDid === legacyDid).length ?? 0;
  const sharedLists = totalLists - ownedLists;
  const totalItems = stats?.totalItems ?? 0;
  const completedItems = stats?.completedItems ?? 0;
  const completionRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  // Format DID for display
  const shortDid = did.length > 24 
    ? `${did.slice(0, 12)}...${did.slice(-8)}`
    : did;

  const initial = (publicProfile?.displayName || displayName || email || 'B').trim().charAt(0).toUpperCase();
  const stats4 = [
    { label: 'Lists Created', value: ownedLists },
    { label: 'Shared Lists', value: sharedLists },
    { label: 'Items Done', value: completedItems },
    { label: 'Completion Rate', value: `${completionRate}%`, accent: true },
  ];
  const sectionTitle = "text-[20px] font-bold tracking-tight text-[var(--boop-ink)] mb-3";

  return (
    <div className="max-w-2xl mx-auto pb-16">
      {/* Back button */}
      <Link
        to="/d"
        onClick={() => haptic('light')}
        className="inline-flex items-center gap-1.5 -ml-1 text-[15px] font-medium text-[var(--boop-muted)] hover:text-[var(--boop-ink)] mb-5 transition-colors"
      >
        <Icon name="chevronLeft" className="w-5 h-5" />
        Back to lists
      </Link>

      {/* Identity */}
      <header className="flex items-center gap-4 mb-8">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 text-[var(--boop-accent)] border-[3px] border-current font-extrabold text-[26px]"
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="min-w-0">
          <h1
            className="text-[var(--boop-ink)] truncate"
            style={{ fontWeight: 780, fontVariationSettings: '"wdth" 86', fontSize: 'clamp(28px, 4.4vw, 36px)', letterSpacing: '-0.035em', lineHeight: 1.05 }}
          >
            {publicProfile?.displayName || displayName || email?.split('@')[0] || 'Anonymous'}
          </h1>
          <p className="text-[15px] text-[var(--boop-muted)] truncate mt-1">
            {email || 'No email set'}
          </p>
        </div>
      </header>

      {/* Name + DID */}
      <div className="boop-sheet mb-10">
        <section className="px-6 py-6" aria-label="Public display name settings">
          <PublicDisplayNameEditor profile={publicProfile} />
        </section>
        <div className="px-6 py-4 border-t border-[var(--boop-line)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--boop-muted)] mb-0.5">Your DID</p>
            <p className="font-mono text-sm text-[var(--boop-ink)] truncate" title={did}>
              {shortDid}
            </p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(did);
              haptic('success');
            }}
            className="p-2 text-[var(--boop-muted)] hover:text-[var(--boop-ink)] hover:bg-[var(--boop-panel)] rounded-lg transition-colors"
            aria-label="Copy DID to clipboard"
          >
            <Icon name="copy" className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <section className="mb-10">
        <h2 className={sectionTitle}>Your Stats</h2>
        <div className="boop-sheet grid grid-cols-2 sm:grid-cols-4">
          {stats4.map((stat, i) => (
            <div
              key={stat.label}
              className={`px-5 py-5 ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''} border-[var(--boop-line)]`}
            >
              <p
                className={`tabular-nums ${stat.accent ? 'text-[var(--boop-accent)]' : 'text-[var(--boop-ink)]'}`}
                style={{ fontWeight: 780, fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1 }}
              >
                {stat.value}
              </p>
              <p className="text-[13px] text-[var(--boop-muted)] mt-2">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Activity Summary */}
      <section className="mb-10">
        <h2 className={sectionTitle}>Activity Summary</h2>
        <div className="boop-sheet px-6 py-5">
          <div className="flex justify-between text-[15px] mb-2.5">
            <span className="text-[var(--boop-muted)]">Overall Progress</span>
            <span className="font-semibold text-[var(--boop-ink)] tabular-nums">
              {completedItems} / {totalItems} items
            </span>
          </div>
          <div className="h-[6px] bg-[var(--boop-line)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--boop-accent)] transition-[width] duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          <p className="text-[13px] text-[var(--boop-muted)] mt-3 tabular-nums">
            {totalItems === 0
              ? 'No items yet.'
              : `${totalItems - completedItems} ${totalItems - completedItems === 1 ? 'item' : 'items'} remaining across your lists.`}
          </p>
        </div>
      </section>

      {/* Subscription / Plan section */}
      <section>
        <h2 className={sectionTitle}>Plan</h2>
        <div className="boop-sheet px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[var(--boop-ink)] capitalize">{plan}</p>
            {subscription?.currentPeriodEnd && plan !== "free" && !referralStats?.referralProUntil && (
              <p className="text-[13px] text-[var(--boop-muted)] mt-0.5">
                {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
            {referralStats?.referralProUntil && referralStats.referralProUntil > Date.now() && (
              <p className="text-[13px] text-[var(--boop-accent)] mt-0.5">
                Referral Pro — expires{" "}
                {new Date(referralStats.referralProUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </p>
            )}
            {referralStats?.totalReferrals != null && referralStats.totalReferrals > 0 && (
              <p className="text-[13px] text-[var(--boop-muted)] mt-0.5">
                {referralStats.totalReferrals} friend{referralStats.totalReferrals === 1 ? "" : "s"} referred
              </p>
            )}
          </div>
          {plan === "free" ? (
            <Link
              to="/pricing"
              onClick={() => haptic('light')}
              className="px-4 py-2 bg-[var(--boop-accent)] hover:bg-[var(--boop-accent-deep)] text-white dark:text-[var(--boop-bg)] text-sm font-semibold rounded-xl transition-colors"
            >
              Upgrade →
            </Link>
          ) : (
            <Link
              to="/pricing"
              onClick={() => haptic('light')}
              className="px-4 py-2 border border-[var(--boop-line)] hover:bg-[var(--boop-panel)] text-[var(--boop-ink)] text-sm font-semibold rounded-xl transition-colors"
            >
              Manage
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
