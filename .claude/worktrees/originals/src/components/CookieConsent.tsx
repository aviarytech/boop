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
      className="fixed bottom-3 left-3 right-3 z-50 safe-area-inset-bottom sm:left-auto sm:right-4 sm:w-[min(24rem,calc(100vw-2rem))]"
    >
      <div className="bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md p-3 backdrop-blur">
        <div className="mb-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Analytics consent
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400">
            We use PostHog to improve boop. No data is sold or shared.{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-amber-700 dark:text-amber-300 hover:text-amber-800"
            >
              Privacy
            </a>
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleMaybeLater}
            className="px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Maybe later
          </button>
          <button
            onClick={handleDecline}
            className="px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            No thanks
          </button>
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 rounded-md bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold transition-colors dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
