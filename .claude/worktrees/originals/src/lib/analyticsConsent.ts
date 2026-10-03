import { initAnalytics } from './analytics';

const CONSENT_KEY = 'poo-cookie-consent';
const SNOOZE_KEY = 'poo-cookie-consent-snoozed-until';
const SNOOZE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

type ConsentState = 'accepted' | 'declined' | null;

export function getStoredConsent(): ConsentState {
  try {
    const val = localStorage.getItem(CONSENT_KEY);
    if (val === 'accepted' || val === 'declined') return val;
  } catch {
    // ignore
  }
  return null;
}

export function storeConsent(value: 'accepted' | 'declined') {
  try {
    localStorage.setItem(CONSENT_KEY, value);
    localStorage.removeItem(SNOOZE_KEY);
  } catch {
    // ignore
  }
}

export function isConsentPromptSnoozed(): boolean {
  try {
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(snoozedUntil) && Date.now() < snoozedUntil;
  } catch {
    // ignore
  }
  return false;
}

export function snoozeConsentPrompt() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DURATION_MS));
  } catch {
    // ignore
  }
}

/** Call this at startup to init analytics if the user previously accepted. */
export function initAnalyticsIfConsented(): void {
  if (getStoredConsent() === 'accepted') {
    initAnalytics();
  }
}
