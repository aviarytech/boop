/**
 * Analytics module — PostHog-backed funnel tracking.
 *
 * Events tracked:
 *   Acquisition:  landing_viewed, landing_cta_clicked, api_quickstart_viewed
 *   Activation:   signup_started, signup_completed, first_list_created
 *   Engagement:   list_created, list_shared, invite_sent
 *   Revenue:      upgrade_page_viewed, upgrade_clicked, upgrade_completed
 *   Retention:    feature_gate_hit
 *
 * Set VITE_POSTHOG_KEY and optionally VITE_POSTHOG_HOST in your .env to enable.
 * Without a key the module is a safe no-op.
 */

import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

let initialized = false;

export function initAnalytics(): void {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,          // auto page views
    capture_pageleave: true,
    autocapture: false,              // we fire explicit events; avoid PII leakage
    persistence: 'localStorage+cookie',
  });
  initialized = true;
}

/** Identify a user after login. */
export function identifyUser(userId: string, traits?: Record<string, string | number | boolean>): void {
  if (!initialized) return;
  posthog.identify(userId, traits);
}

/** Clear identity on logout. */
export function resetAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
}

/** Core capture helper — all events route through here. */
function capture(event: string, props?: Record<string, string | number | boolean | null>): void {
  if (!initialized) return;
  posthog.capture(event, props);
}

// ---------------------------------------------------------------------------
// Funnel events
// ---------------------------------------------------------------------------

/** Visitor hit the marketing landing page. */
export function trackLandingViewed(): void {
  capture('landing_viewed');
}

/**
 * Visitor clicked a CTA on the marketing landing page.
 * `cta` is what the button leads to; `section` is where on the page it lives
 * (hero, path_you, path_team, path_agents, pricing, cta_band, nav, footer).
 */
export function trackLandingCtaClicked(
  cta: 'signup' | 'signin' | 'quickstart' | 'pricing',
  section: string
): void {
  capture('landing_cta_clicked', { cta, section });
}

/** Visitor viewed the API quickstart docs page. */
export function trackQuickstartViewed(): void {
  capture('api_quickstart_viewed');
}

/** User submitted their email to start OTP flow. */
export function trackSignupStarted(email: string): void {
  // Hash the email so PII doesn't hit PostHog as a plain string.
  capture('signup_started', { email_domain: email.split('@')[1] ?? 'unknown' });
}

/** OTP verified — user is now authenticated for the first time. */
export function trackSignupCompleted(plan: string): void {
  capture('signup_completed', { plan });
}

/** User created their very first list ever. */
export function trackFirstListCreated(): void {
  capture('first_list_created');
}

/** User created a list (any list). */
export function trackListCreated(listCount: number): void {
  capture('list_created', { list_count: listCount });
}

/** User hit a free-plan feature gate. */
export function trackFeatureGateHit(gate: string, plan: string): void {
  capture('feature_gate_hit', { gate, plan });
}

/** User published / shared a list. */
export function trackListShared(method: 'webvh' | 'link' | 'email' | 'sms'): void {
  capture('list_shared', { method });
}

/** User copied or sent an invite link. */
export function trackInviteSent(method: 'copy' | 'native_share'): void {
  capture('invite_sent', { method });
}

/** User viewed the pricing / upgrade page. */
export function trackUpgradePageViewed(source: string): void {
  capture('upgrade_page_viewed', { source });
}

/** User clicked an upgrade / subscribe CTA. */
export function trackUpgradeClicked(plan: string, source: string): void {
  capture('upgrade_clicked', { plan, source });
}

/** Stripe checkout completed successfully. */
export function trackUpgradeCompleted(plan: string): void {
  capture('upgrade_completed', { plan });
}
