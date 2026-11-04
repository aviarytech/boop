/**
 * Pricing page — Free vs Pro vs Team comparison with upgrade flow.
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useBilling } from "../hooks/useBilling";
import { useAuth } from "../hooks/useAuth";
import { trackUpgradePageViewed, trackUpgradeClicked } from "../lib/analytics";
import { PublicHeader, publicNavLink } from "../components/PublicHeader";
import { Icon } from "../components/ui/Icon";

const CONVEX_SITE_URL = import.meta.env.VITE_CONVEX_HTTP_URL as string;

// Price IDs injected at build time from env
const PRO_MONTHLY_PRICE_ID = import.meta.env.VITE_STRIPE_PRO_MONTHLY_PRICE_ID as string | undefined;
const PRO_YEARLY_PRICE_ID = import.meta.env.VITE_STRIPE_PRO_YEARLY_PRICE_ID as string | undefined;
const TEAM_PRICE_ID = import.meta.env.VITE_STRIPE_TEAM_PRICE_ID as string | undefined;

type BillingInterval = "monthly" | "yearly";

export function Pricing() {
  const navigate = useNavigate();
  const { isAuthenticated, token } = useAuth();
  useCurrentUser();
  const { plan, subscription, isLoading } = useBilling();
  const [interval, setInterval] = useState<BillingInterval>("yearly");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("scrollable-page");
    trackUpgradePageViewed(document.referrer ? "referrer" : "direct");
    return () => document.body.classList.remove("scrollable-page");
  }, []);

  async function startCheckout(priceId: string, planName: string) {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    if (!priceId) {
      setError("Billing not configured yet. Check back soon.");
      return;
    }
    trackUpgradeClicked(planName, "pricing_page");
    setLoading(priceId);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await fetch(`${CONVEX_SITE_URL}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${origin}/d?billing=success`,
          cancelUrl: `${origin}/pricing`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to create checkout session");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await fetch(`${CONVEX_SITE_URL}/api/billing/portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ returnUrl: `${origin}/pricing` }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to open portal");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  const proPrice = interval === "yearly" ? "$48/yr" : "$5/mo";
  const proSavings = interval === "yearly" ? " (save 20%)" : "";
  const proPriceId = interval === "yearly" ? PRO_YEARLY_PRICE_ID : PRO_MONTHLY_PRICE_ID;

  return (
    <div className="min-h-screen bg-[var(--boop-bg)]">
    <PublicHeader>
      {isAuthenticated
        ? <Link to="/d" className={publicNavLink}>Back to app</Link>
        : <Link to="/login" className={publicNavLink}>Sign in</Link>}
    </PublicHeader>
    <div className="max-w-5xl mx-auto pt-12 sm:pt-16 pb-8 px-5 sm:px-8">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-[clamp(36px,6vw,56px)] font-extrabold leading-[1.02] tracking-[-0.03em] text-[var(--boop-ink)] mb-3">
          Simple, honest pricing
        </h1>
        <p className="text-[var(--boop-muted)] text-lg">
          Start free. Upgrade when you need more.
        </p>

        {/* Billing interval toggle */}
        <div className="inline-flex items-center gap-1 mt-7 rounded-xl bg-[var(--boop-panel)] p-1">
          <button
            onClick={() => setInterval("monthly")}
            aria-pressed={interval === "monthly"}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              interval === "monthly"
                ? "bg-[var(--boop-card)] text-[var(--boop-ink)] shadow-[0_0_0_1px_var(--boop-line)]"
                : "text-[var(--boop-muted)] hover:text-[var(--boop-ink)]"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval("yearly")}
            aria-pressed={interval === "yearly"}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              interval === "yearly"
                ? "bg-[var(--boop-card)] text-[var(--boop-ink)] shadow-[0_0_0_1px_var(--boop-line)]"
                : "text-[var(--boop-muted)] hover:text-[var(--boop-ink)]"
            }`}
          >
            Yearly
            <span className="ml-1.5 text-xs font-semibold bg-[var(--boop-accent-soft)] text-[var(--boop-accent-ink)] px-1.5 py-0.5 rounded-full">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Free */}
        <PlanCard
          name="Free"
          price="$0"
          priceDetail="forever"
          description="For personal use"
          current={plan === "free"}
          features={[
            "Up to 5 lists",
            "1 page on *.boop.ad",
            "Up to 3 collaborators per list",
            "Real-time sync",
            "Offline support",
            "Basic DID identity",
            "API access for your agents",
          ]}
          cta={
            plan === "free" ? (
              <span className="block w-full py-2.5 text-center rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] text-sm font-medium cursor-default">
                Current plan
              </span>
            ) : (
              <span className="block w-full py-2.5 text-center rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] text-sm font-medium cursor-default">
                Downgrade via portal
              </span>
            )
          }
        />

        {/* Pro */}
        <PlanCard
          name="Pro"
          price={proPrice}
          priceDetail={proSavings || "per month"}
          description="For power users"
          highlight
          current={plan === "pro"}
          features={[
            "Unlimited lists",
            "5 pages + custom domains",
            "Unlimited collaborators",
            "Verifiable credentials (VC)",
            "List templates",
            "Export / backup",
            "Priority sync",
          ]}
          cta={
            isLoading ? (
              <div className="w-full py-2.5 text-center rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] text-sm font-medium animate-pulse">
                Loading…
              </div>
            ) : plan === "pro" ? (
              <button
                onClick={openPortal}
                disabled={loading === "portal"}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading === "portal" ? "Opening…" : "Manage subscription"}
              </button>
            ) : plan === "team" ? (
              <span className="block w-full py-2.5 text-center rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] text-sm font-medium cursor-default">
                Included in Team
              </span>
            ) : (
              <button
                onClick={() => proPriceId && startCheckout(proPriceId, "pro")}
                disabled={!proPriceId || loading === proPriceId}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading === proPriceId ? "Redirecting…" : `Upgrade to Pro`}
              </button>
            )
          }
        />

        {/* Team */}
        <PlanCard
          name="Team"
          price="$12"
          priceDetail="per user / month"
          description="For small teams"
          current={plan === "team"}
          features={[
            "Everything in Pro",
            "Team workspace",
            "Admin controls",
            "Shared templates library",
            "Priority support",
          ]}
          cta={
            isLoading ? (
              <div className="w-full py-2.5 text-center rounded-xl bg-[var(--boop-panel)] text-[var(--boop-muted)] text-sm font-medium animate-pulse">
                Loading…
              </div>
            ) : plan === "team" ? (
              <button
                onClick={openPortal}
                disabled={loading === "portal"}
                className="w-full py-2.5 rounded-xl bg-[var(--boop-ink)] hover:opacity-90 text-[var(--boop-bg)] text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading === "portal" ? "Opening…" : "Manage subscription"}
              </button>
            ) : (
              <button
                onClick={() => TEAM_PRICE_ID && startCheckout(TEAM_PRICE_ID, "team")}
                disabled={!TEAM_PRICE_ID || loading === TEAM_PRICE_ID}
                className="w-full py-2.5 rounded-xl bg-[var(--boop-ink)] hover:opacity-90 text-[var(--boop-bg)] text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading === TEAM_PRICE_ID ? "Redirecting…" : "Upgrade to Team"}
              </button>
            )
          }
        />
      </div>

      {/* Manage existing subscription */}
      {isAuthenticated && subscription && plan !== "free" && (
        <div className="mt-8 text-center">
          <p className="text-sm text-[var(--boop-muted)]">
            {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd ? (
              <>
                Your subscription will cancel on{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}.{" "}
              </>
            ) : subscription.currentPeriodEnd ? (
              <>
                Next billing date:{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}.{" "}
              </>
            ) : null}
            <button
              onClick={openPortal}
              className="text-[var(--boop-accent)] hover:underline font-medium"
            >
              Manage subscription →
            </button>
          </p>
        </div>
      )}

      {/* Back link */}
      <div className="mt-10 text-center">
        <Link
          to="/d"
          className="text-sm text-[var(--boop-muted)] hover:text-[var(--boop-ink)] transition-colors"
        >
          ← Back to app
        </Link>
      </div>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanCard component
// ---------------------------------------------------------------------------

interface PlanCardProps {
  name: string;
  price: string;
  priceDetail: string;
  description: string;
  features: string[];
  current?: boolean;
  highlight?: boolean;
  cta: React.ReactNode;
}

function PlanCard({ name, price, priceDetail, description, features, current, highlight, cta }: PlanCardProps) {
  return (
    <div
      className={`relative rounded-2xl p-6 flex flex-col border transition-shadow ${
        highlight
          ? "border-amber-500 bg-[var(--boop-card)] shadow-[0_24px_48px_-32px_oklch(25%_0.04_200/0.35)]"
          : "border-[var(--boop-line)] bg-[var(--boop-card)]"
      } ${current ? "ring-2 ring-[var(--boop-ink)]/70" : ""}`}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">
            Most popular
          </span>
        </div>
      )}
      {current && (
        <div className="absolute -top-3 right-4">
          <span className="bg-[var(--boop-ink)] text-[var(--boop-bg)] text-xs font-bold px-3 py-1 rounded-full shadow-sm">
            Current plan
          </span>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-[var(--boop-ink)] mb-1">{name}</h2>
        <p className="text-sm text-[var(--boop-muted)] mb-4">{description}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-extrabold tracking-[-0.02em] text-[var(--boop-ink)]">{price}</span>
          <span className="text-sm text-[var(--boop-muted)]">{priceDetail}</span>
        </div>
      </div>

      <ul className="space-y-2.5 flex-1 mb-6">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-[var(--boop-ink)]">
            <Icon name="check" className="w-4 h-4 mt-0.5 text-[var(--boop-accent)]" strokeWidth={2.5} />
            {f}
          </li>
        ))}
      </ul>

      {cta}
    </div>
  );
}
