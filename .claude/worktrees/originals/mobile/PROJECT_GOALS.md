# boop Mobile — Project Goals

**Date:** 2026-02-07
**Status:** Active

## Vision
Build a native mobile app for boop (iOS + Android) that maximizes code reuse from the existing React + Vite + Convex web app.

## Key Goals

1. **Native Mobile Experience** — Push notifications, offline support, app store distribution (Apple App Store + Google Play)
2. **Maximum Code Sharing** — Reuse the existing React/Vite/Convex codebase with minimal duplication
3. **Feature Parity** — All web app features available on mobile from day one
4. **Ship MVP Fast** — Leverage existing codebase to get to market quickly

## Success Criteria
- App available on both iOS and Android app stores
- Push notifications working on both platforms
- Offline-capable (read cached data, queue writes)
- Same authentication flow as web
- <10% platform-specific code
- MVP shipped within 6 weeks

## Success Metrics
- **App Store Approval:** App approved and published on both Apple App Store and Google Play Store
- **Performance:** < 3 second cold start time on both platforms
- **Push Notifications:** Working reliably on iOS (APNs) and Android (FCM)
- **Offline Support:** Users can view cached lists without network connectivity
- **Feature Parity:** All core web app features available on mobile (create/edit/check items, share lists, auth)
- **Bundle Size:** < 5% increase in overall bundle size from adding Capacitor/native layers
- **Stability:** < 1% crash rate in production
- **User Adoption:** Measurable installs within first month of launch

## Non-Goals (for MVP)
- Tablet-optimized layouts
- Platform-specific UI (Material/Cupertino) — web UI is fine
- Widgets or watch apps
- Background sync beyond basic offline queue

## Stakeholders
- **Brian** — Founder/developer, decision-maker
- **Krusty** — AI agent/developer, implementation
