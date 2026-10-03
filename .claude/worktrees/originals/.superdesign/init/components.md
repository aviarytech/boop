# Shared UI Primitives Inventory

## Core UI Components (`src/components/ui/`)
- **EmptyState.tsx** — Empty state illustrations (NoListsEmptyState, NoSearchResultsEmptyState, NoItemsEmptyState)
- **Panel.tsx** — Reusable panel/card container
- **SearchInput.tsx** — Search input with icon
- **Skeleton.tsx** — Loading skeleton placeholders (HomePageSkeleton, ListViewSkeleton)
- **SortDropdown.tsx** — Sort options dropdown

## List Components (`src/components/lists/`)
- **CategoryHeader.tsx** — Collapsible category section header
- **CategoryManager.tsx** — Category CRUD modal
- **CategorySelector.tsx** — Category picker

## Auth Components (`src/components/auth/`)
- **AuthGuard.tsx** — Route protection wrapper
- **OtpInput.tsx** — OTP code input for login

## Sharing Components (`src/components/sharing/`)
- **CollaboratorList.tsx** — List of collaborators with roles

## Notification Components (`src/components/notifications/`)
- **Toast.tsx** — Toast notification container

## Feature Components (`src/components/`)
- **AddItemInput.tsx** — Text input for adding new items
- **ListCard.tsx** — Card preview of a list (used on Home page)
- **ListItem.tsx** — Individual todo item row with check, drag, edit
- **HeaderActionsMenu.tsx** — Overflow menu (⋯) for list actions
- **ProfileBadge.tsx** — User avatar/badge in header
- **VerificationBadge.tsx** — VC verification status indicator
- **ItemDetailsModal.tsx** — Full item detail/edit modal
- **ShareModal.tsx** — Sharing/invite modal
- **CreateListModal.tsx** — New list creation modal
- **TemplatePickerModal.tsx** — Template selection for new lists
- **SaveAsTemplateModal.tsx** — Save list as template
- **DeleteListDialog.tsx** — Delete confirmation dialog
- **RenameListDialog.tsx** — Rename list dialog
- **ChangeCategoryDialog.tsx** — Change list category
- **ConfirmDialog.tsx** — Generic confirmation dialog
- **CalendarView.tsx** — Calendar view for items with due dates
- **BatchOperations.tsx** — Bulk actions bar for multi-select
- **SubItems.tsx** — Nested sub-items
- **TagSelector.tsx** — Tag picker
- **Comments.tsx** — Item comments
- **Attachments.tsx** — File attachments
- **Settings.tsx** — App settings panel
- **ErrorBoundary.tsx** — Error boundary wrapper
- **AppLockGuard.tsx** — App lock/biometric guard

## Design System Notes
- Uses Tailwind CSS v4 with `@import "tailwindcss"`
- Dark mode via `.dark` class variant
- Color palette: amber/orange primary, gray neutrals
- Rounded corners: `rounded-xl` to `rounded-3xl`
- Shadows: `shadow-lg`, `shadow-xl` with colored shadows (e.g., `shadow-amber-500/20`)
- Animations: slide-up, float, bounce-slow, shimmer (custom keyframes)
- Mobile: safe-area-inset support, touch targets, haptic feedback hooks
