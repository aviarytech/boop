/**
 * Referral invite component.
 * Shows the user's unique invite link, a copy button, and referral stats.
 * Embed in Settings and in the plan-limit screen of CreateListModal.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { Id } from "../../convex/_generated/dataModel";
import { buildReferralInviteUrl } from "../lib/inviteLinks";

interface ReferralInviteProps {
  /** Convex user ID — caller resolves this from their context */
  userId: Id<"users">;
  /** If true, shows a compact inline layout instead of full card */
  compact?: boolean;
}

export function ReferralInvite({ userId, compact = false }: ReferralInviteProps) {
  const getOrCreateCode = useMutation(api.referrals.getOrCreateReferralCode);
  const codeRecord = useQuery(api.referrals.getReferralCode, { userId });
  const stats = useQuery(api.referrals.getReferralStats, { userId });

  const [copied, setCopied] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  // Prefer already-existing code from query, fall back to locally generated one
  const activeCode = codeRecord?.code ?? code;
  const referralUrl = activeCode
    ? buildReferralInviteUrl(activeCode)
    : null;

  const referralProUntil = stats?.referralProUntil ?? null;
  const proActive = referralProUntil != null && referralProUntil > Date.now();
  const proExpiryDate = proActive
    ? new Date(referralProUntil!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  const handleGetLink = async () => {
    if (activeCode) return;
    setGeneratingCode(true);
    try {
      const newCode = await getOrCreateCode({ userId });
      setCode(newCode);
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers / non-HTTPS
      const el = document.createElement("textarea");
      el.value = referralUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (!referralUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: "Join me on boop",
        text: "I use boop to manage my lists. Sign up with my link and we both get 1 month Pro free!",
        url: referralUrl,
      });
    } else {
      handleCopy();
    }
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Invite a friend → both of you get <strong>1 month Pro free</strong>.
        </p>
        {referralUrl ? (
          <div className="flex gap-2">
            <input
              readOnly
              value={referralUrl}
              className="flex-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 truncate"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            onClick={handleGetLink}
            disabled={generatingCode}
            className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {generatingCode ? "Generating…" : "Get invite link"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {proActive && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <span className="text-base">🌟</span>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>Pro active via referral</strong> — expires {proExpiryDate}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xl">🎁</span>
        <div>
          <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
            Invite a friend, get 1 month Pro free
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Both you and your friend unlock 30 days of Pro — free.
            {(stats?.totalReferrals ?? 0) > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                {stats!.totalReferrals} friend{stats!.totalReferrals === 1 ? "" : "s"} joined so far!
              </span>
            )}
          </p>
        </div>
      </div>

      {referralUrl ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={referralUrl}
              className="flex-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 truncate"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {"share" in navigator && (
            <button
              onClick={handleShare}
              className="w-full px-4 py-2 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              Share invite link
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={handleGetLink}
          disabled={generatingCode}
          className="w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {generatingCode ? "Generating link…" : "Get my invite link"}
        </button>
      )}
    </div>
  );
}

/**
 * Convenience wrapper that resolves userId from the current auth context.
 */
export function ReferralInviteCurrentUser({ compact }: { compact?: boolean }) {
  const { subOrgId, isAuthenticated } = useCurrentUser();
  const convexUser = useQuery(
    api.auth.getUserByTurnkeyId,
    isAuthenticated && subOrgId ? { turnkeySubOrgId: subOrgId } : "skip"
  );

  if (!convexUser?._id) return null;
  return <ReferralInvite userId={convexUser._id} compact={compact} />;
}
