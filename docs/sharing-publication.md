# Named sharing and public publication (#259)

A publication grants public **reading**, never editing. Existing public list URLs
remain readable without signing in while their publication is active. Signing in,
bookmarking a list, having authored an item, or holding a broadly scoped API key
does not grant editing. Every non-owner writer needs an accepted editor grant;
API-key scope is an additional restriction, not a replacement for that grant.

This intentionally changes compatibility for historical public collaborators:
people who previously edited through public links must now receive and accept an
editor invitation from the owner. No historical collaborator membership is
inferred or automatically created. Existing viewer grants remain read-only.

## Owner and recipient flow

Open the list's sharing panel or choose **Share with people** in its menu. Choose
**Invite people and manage access** to open Invitations with this owned list
selected. Enter the recipient's email and explicitly choose **Editor** (Viewer is
the default). The recipient signs in with that verified email, reviews the
invitation, and explicitly accepts it. See [Private invitations](private-invitations.md)
for delivery, identity, expiration, acceptance and resend behavior.

**Publish publicly** is a separate choice. Sending/accepting an invitation,
changing a grant role and revoking a grant never publish or unpublish the list.
A published list with named grants is still public, not private.

Removing a named grant ends its editing/private access but cannot stop that person
reading through public links while publication remains active. **Unpublish** ends
public reads. Other accepted viewers and editors retain their private access via
the authenticated app. Unpublishing does not revoke grants; republishing does not
restore revoked grants. Previously downloaded content is not recalled.

## Audited paths

- `convex/lib/permissions.ts`: edit requires owner/editor; public status is only a
  read fallback. `actorMutation` enforces these checks at the server boundary.
- `lists.getList`: nullable access-checked reads now include a scope-aware
  `canEdit` capability for legacy public-link controls. This additive response
  field is not stored or accepted as write authority.
- `SharedListResource`: anonymous public reads remain; login and bookmarking do
  not enable item toggles. Owner/editor capability enables authenticated POSTs.
  A denied write rolls back optimistic state. A public 404 clears displayed data
  on the next poll; accepted private access uses the authenticated list route.
- `ListView`: accepted-role controls already gate item, keyboard, batch and drag
  edits. Menus distinguish named invitations, public publication and sending a
  public read link. Native public-link sending is offered only for active publication.
- `publication.bookmarkList` and `lists.getUserLists`: bookmarks remain discovery
  records with the existing quota, not grants. Notification and quota copy now
  say bookmarks. Discovery stops exposing an unpublished list to a bookmark-only
  user while accepted private grants continue to work.
- `PublicList` remains an anonymous read-only view; its sign-in copy asks for an
  editor invitation. Retired `/join` links now point to the email invitation
  path rather than implying that publication permits collaboration.
- Direct/legacy and internal item mutations, `/api/items/*`, API-key routes and
  `/d/:owner/resources/list-:id/items/:item/:check-or-uncheck`: authorization
  requires accepted editing, including for published lists. Public DID resource
  GETs and `publication.getPublicList` require active publication and return no
  private content after unpublishing, even to a private grantee.
- ShareModal, PublishModal, Invitations, CreateListModal and OnboardingFlow copy
  distinguish public reading from accepted editing. Revocation explains the
  remaining public access beside the management controls.

## Verification and boundaries

Regression suites: `scripts/private-sharing.test.mjs`,
`scripts/shared-list-auth.test.mjs`, `scripts/sharing-publication-ui.test.mjs` and
`scripts/invitations-ui.test.mjs`. These execute real backend handlers with
in-memory storage and rendered React components with mocked transport. They do
not exercise live Convex transactions, delivery, subscriptions, or native devices.

This does not add public-note publishing, alter hosted Sites/template visibility,
or implement the broader #258 sharing dashboard. Attachment/offline/cache lifetime
and queued-write recovery remain #260. No deployment, codegen, historical grant
migration or production operation is part of this change.
