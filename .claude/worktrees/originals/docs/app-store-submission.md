# iOS App Store Submission — boop

## App Store Listing Copy

### Title (max 30 chars)
```
boop - Todo & Task Lists
```
(24 chars)

### Subtitle (max 30 chars)
```
Organize While You Poop
```
(23 chars)

### Bundle ID
```
ad.boop.app
```

### Primary Category
**Productivity**

### Secondary Category
**Utilities**

### Keywords (max 100 chars)
```
todo,tasks,lists,offline,collaborate,share,groceries,reminders,productivity,checklist
```
(86 chars)

---

## Description (max 4000 chars)

```
boop is the todo list that meets you where you are — on the toilet, on the train, or anywhere without Wi-Fi.

Create lists. Check things off. Share with your crew. Works offline, syncs everywhere.

KEY FEATURES

Real-time sync
Every change appears instantly across all your devices. No refresh needed — your lists are always live.

Works offline
No signal? No problem. Add and check off tasks without internet. Everything syncs automatically when you're back online.

Share & collaborate
Share lists with family, roommates, or teammates. Real-time updates keep everyone on the same page.

Templates built in
Jump-start any list with pre-built templates for groceries, chores, goals, packing, and more.

Cryptographically yours
Every list is signed with your personal DID (Decentralized Identifier). Proof of ownership, always. Nobody can impersonate your data.

Free to start
Create up to 5 lists and collaborate with 3 people per list — no credit card required. Upgrade to Pro for unlimited everything.

PRO FEATURES
- Unlimited lists
- Unlimited collaborators
- Verifiable credentials
- Templates + export

PERFECT FOR
- Grocery shopping
- Work tasks and projects
- Home chores with roommates
- Travel packing lists
- Family to-do lists
- Anything you need to remember while sitting down

Privacy policy: https://boop.ad/privacy
```

(~1300 chars — well under limit)

---

## Screenshots (6.7" iPhone — required)

Five screenshots needed. Capture from iPhone 15 Pro Max simulator or device (1290 × 2796 px).

### Screenshot 1 — Hero / Home screen
**Content:** Home screen showing 3-4 lists with emoji icons (e.g., "Groceries 🛒", "Work Tasks ✅", "Packing ✈️")
**Caption overlay:** "All your lists, right here"

### Screenshot 2 — List view with items
**Content:** Open list with several items, some checked, some unchecked. Mix of checked (strikethrough) and active items.
**Caption overlay:** "Check things off as you go"

### Screenshot 3 — Offline mode
**Content:** App in use with offline banner visible, or add an item while offline
**Caption overlay:** "Works without Wi-Fi"

### Screenshot 4 — Share / Collaborate
**Content:** Share sheet or the collaborators panel on a list showing multiple user avatars
**Caption overlay:** "Share lists with anyone"

### Screenshot 5 — Templates
**Content:** Templates screen showing available templates (Groceries, Work, Packing, etc.)
**Caption overlay:** "Start fast with templates"

### Generating Screenshots
```bash
# Build the web app first
bun run build

# Sync to iOS
npx cap sync ios

# Open in Xcode, run on iPhone 15 Pro Max simulator
# Use cmd+S in simulator to save screenshot
```

---

## App Store Connect Submission Checklist

### Before Submitting (Engineer tasks — can be done now)
- [x] Privacy policy live at https://boop.ad/privacy (deploy this PR)
- [ ] 5 screenshots captured at 1290×2796 (iPhone 15 Pro Max)
- [ ] App icon: 1024×1024 PNG, no alpha channel (check resources/ios/)
- [ ] Verify bundle ID `ad.boop.app` matches Xcode project
- [ ] Set version to 1.0.0 and build number to 1 in Xcode
- [ ] Archive build in Xcode (Product → Archive)
- [ ] Upload to App Store Connect via Xcode Organizer

### App Store Connect Form Fields (requires Apple Developer account)
- [ ] Sign in to https://appstoreconnect.apple.com
- [ ] Create new app with bundle ID `ad.boop.app`
- [ ] Paste listing copy from this doc
- [ ] Upload screenshots
- [ ] Set pricing: Free (with in-app purchases for Pro)
- [ ] Add in-app purchase for Pro subscription (monthly + annual)
- [ ] Set age rating: 4+
- [ ] Privacy policy URL: https://boop.ad/privacy
- [ ] Support URL: https://boop.ad
- [ ] Submit for review

### Requires Board / Human Action
- Apple Developer Program membership ($99/year) — must be enrolled at developer.apple.com
- App Store Connect access
- Xcode on a Mac to archive and upload the build
- In-app purchase setup in App Store Connect

---

## App Info

| Field | Value |
|-------|-------|
| Bundle ID | ad.boop.app |
| App Name | boop |
| Version | 1.0.0 |
| Build | 1 |
| Category | Productivity |
| Age Rating | 4+ |
| Price | Free |
| Privacy Policy | https://boop.ad/privacy |
| Support URL | https://boop.ad |
| Copyright | 2026 boop |

---

## Notes

- The Capacitor config is already set with `appId: 'ad.boop.app'` and `appName: 'boop'`
- iOS folder exists at `app/ios/` — should be ready to open in Xcode
- Submission will be rejected without a valid privacy policy URL — deploy this PR first
- Apple review typically takes 1-3 business days for a new app
