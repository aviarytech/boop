# Note save concurrency and draft recovery

`notes.updateNoteBody` and its authenticated internal/API-key operation require
an exact `expectedBody` matching the current stored body. Read `getNoteBody`,
retain the returned `body` as the editing base, then submit:

```ts
await client.mutation(api.notes.updateNoteBody, {
  listId,
  body: reconciledText,
  expectedBody: bodyReadBeforeEditing,
  // Include the current session authToken or scoped apiKey.
});
```

The check and write run in one Convex mutation transaction. Competing changes
cannot silently overwrite a different current body. This is content-based
compare-and-swap, not a revision/history counter: a body that changes and later
returns to exactly the same text matches the same expected state. Live co-editing
and merge algorithms are not provided.

## Compatibility and authorization

- `expectedBody` stays optional in the wire validator only to return the existing
  recoverable `NOTE_CONFLICT` error for old clients. Omission always rejects,
  including first writes and no-op/empty writes. There is no force-write option.
- An empty note, including a legacy note without a body row, requires
  `expectedBody: ""`. Reads need no migration; no codegen or schema change is needed.
- A mismatch or missing base returns `ConvexError.data.code === "NOTE_CONFLICT"`
  without any source text. The body and card summary remain unchanged.
- Authentication, API scope (`items:write`) and current editor permission are
  checked before reading/comparing the body. Revoked/viewer/unauthorized writes
  remain permission errors, not conflicts; no current body is disclosed.
- API keys use the same mutation handler and inherit current account permissions.
  After a conflict, authorized clients must read again, reconcile deliberately,
  and submit that read's body as the next expected state. A later intervening
  write can conflict again. Old callers must upgrade; never fetch a fresh base
  automatically merely to force through an old draft.

## Client and offline behavior

The note editor retains its original expected body while editing or disconnected.
The existing Convex mutation transport and local draft storage are retained;
notes do not introduce a new IndexedDB replay operation or alter #238's queue
semantics. Reconnecting uses the same server rule. The existing comparison UI
keeps the local draft, shows the authorized subscription version, and offers
explicit discard or conditional replacement. Editing a conflict does not bypass
it. On reload, a saved draft with a different or unknown base needs reconciliation.

Drafts are keyed by the editing account's DID and resource, with separate records
per editor session. They no longer use a shared resource owner's DID. Existing
owner drafts retain their keys. Historical drafts saved by shared recipients in
an owner's namespace cannot safely be attributed; they are not automatically
migrated into another account's namespace. Browser storage failure retains drafts
in memory for SPA navigation only, not reliably across a full reload.

Permission rejection stops automatic/retry/reconciliation writes in that mounted
editor. Reopening with current permission allows editing again. If the resource
becomes unavailable, or the user becomes a viewer, their local draft can be copied
or downloaded as independent plain text without fetching the source. A denied
save hides the source editor even before the subscription catches up. The export
contains only local draft text, not the stored editing base or sharing metadata.
The item-note editor also presents the shared autosave hook's permission-denied
state; this change does not alter item-description API/replay concurrency contracts.

This is draft recovery, not the complete #260 cache/attachment revocation work.
It does not recall downloaded exports or erase every previously cached source.

## Verification and limits

Focused commands (from the assigned checkout):

```sh
node --test scripts/note-concurrency.test.mjs scripts/note-guards.test.mjs scripts/private-sharing.test.mjs scripts/autosave-draft.test.mjs scripts/note-view-recovery.test.mjs scripts/item-note-recovery.test.mjs
node_modules/.bin/tsc -b
node_modules/.bin/eslint convex/notes.ts src/hooks/useAutosaveDraft.ts src/pages/NoteView.tsx src/pages/NoteEditor.tsx src/components/RecoveredNoteDrafts.tsx
VITE_CONVEX_URL=https://placeholder.convex.cloud node_modules/.bin/vite build
```

Real server-handler tests cover two writers, explicit reconciliation, omitted
legacy bases, empty initialization, API keys/scopes, revoked editors and viewer
downgrades, and nondisclosing errors. Mounted React tests cover delayed offline
reconnect, conflict retention, conditional resubmission, denial before subscription
updates, revoked/downgraded recovery, exact export bytes, account isolation, and
both callers of the autosave hook. The reusable fixture builder at
`scripts/helpers/note-view-fixture.mjs` can also bundle the real note page for a
local browser preview with mocked server/account controls.

Fixtures do not simulate Convex transaction retry, live subscriptions, the native
Capacitor download/save experience, or real device networking. No live backend,
codegen, migration, deployment or production account was used. Native iOS/Android
and production rollout verification remain separate gates.
