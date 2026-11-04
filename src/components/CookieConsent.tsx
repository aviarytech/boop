/**
 * Cookie consent banner for GDPR compliance.
 * Shown on first visit; persists accept/decline in localStorage.
 * On accept, initializes PostHog analytics. On decline, analytics stays off.
 */

import { useState, useEffect } from 'react';
import { initAnalytics } from '../lib/analytics';
import {
  getStoredConsent,
  isConsentPromptSnoozed,
  snoozeConsentPrompt,
  storeConsent,
} from '../lib/analyticsConsent';

const DISPLAY_DELAY_MS = 1200;

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getStoredConsent() !== null || isConsentPromptSnoozed()) return;

    const timeoutId = window.setTimeout(() => {
      setVisible(true);
    }, DISPLAY_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    storeConsent('accepted');
    initAnalytics();
    setVisible(false);
  };

  const handleDecline = () => {
    storeConsent('declined');
    setVisible(false);
  };

  const handleMaybeLater = () => {
    snoozeConsentPrompt();
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed bottom-3 left-3 right-3 z-50 safe-area-inset-bottom sm:right-auto sm:left-4 sm:w-[min(24rem,calc(100vw-2rem))]"
    >
      <div className="bg-[color-mix(in_oklch,var(--boop-card)_95%,transparent)] border border-[var(--boop-line)] rounded-xl shadow-[0_16px_32px_-20px_oklch(25%_0.04_200/0.35)] p-3 backdrop-blur">
        <div className="mb-3">
          <p className="text-sm font-semibold text-[var(--boop-ink)]">
            Analytics consent
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--boop-muted)]">
            We use PostHog to improve boop. No data is sold or shared.{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-[var(--boop-accent)] hover:text-[var(--boop-accent-deep)]"
            >
              Privacy
            </a>
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleMaybeLater}
            className="px-2 py-1.5 border border-transparent text-xs font-medium text-[var(--boop-muted)] hover:text-[var(--boop-ink)] transition-colors"
          >
            Maybe later
          </button>
          <button
            onClick={handleDecline}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--boop-line)] text-xs font-medium text-[var(--boop-ink)] hover:bg-[var(--boop-panel)] transition-colors"
          >
            No thanks
          </button>
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 rounded-lg border border-transparent bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
