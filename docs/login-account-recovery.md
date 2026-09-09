# Recover login after duplicate accounts

Boop resolves returning users from its own email-to-Turnkey account records.
A Turnkey parent organization can contain identities from several applications;
the first global email-search result is not an application account mapping.

When an email matches multiple Boop users, sign-in stops with an account recovery
message until an operator explicitly selects the intended record. A single
existing account continues to work without a migration. New Boop users receive a
new Turnkey identity even if their email is registered in another application.

## Production rollout

1. Deploy the backend containing `isCanonicalLogin`, `auth.getLoginAccount`, and
   `auth.selectLoginAccount`. The schema change is optional and needs no backfill.
2. Inspect the affected users and confirm the intended account against its DID,
   Turnkey identity, existing lists, and the incident evidence. Do not infer it
   from result order, list count, or creation time alone.
3. Use the internal operator mutation to select that existing Boop user:

   ```sh
   npx convex run --prod auth:selectLoginAccount '{"email":"owner@example.com","userId":"<verified-existing-user-id>"}'
   ```

   Replace both values with verified production identifiers. The mutation checks
   the exact email, requires an existing Turnkey link, and atomically marks that
   user as canonical while clearing the flag on the other users for that email.
   Save its returned previous flags with the incident record. It cannot be called
   through the public Convex client.
4. Confirm the internal lookup returns the selected Turnkey identity:

   ```sh
   npx convex run --prod auth:getLoginAccount '{"email":"owner@example.com"}'
   ```

5. Sign out of the affected browser/app and request a fresh OTP. Confirm the
   original profile and lists appear. Previously issued JWTs are not revoked by
   this operation; they retain their existing identity until logout or expiry.
   Pending OTP sessions for a different account must request a new code.

Selection does not merge, delete, or transfer users, DIDs, lists, or Turnkey
identities. Preserve any data on duplicate Boop accounts for a separate reviewed
recovery. Preserve identities belonging to other applications.

To undo an incorrect selection, run the same operation with the previously
verified user ID. Do not roll back to global Turnkey email lookup: that reopens
the account-switching bug. If the correct account cannot be established, leave
the email blocked for recovery rather than picking an arbitrary user.

## Verification

`node --test scripts/login-account.test.mjs` exercises the real Convex handlers
and Turnkey request signing with a mocked network. It covers foreign Turnkey
matches, ambiguous accounts, operator selection, stale OTP sessions, signup
conflicts, database failures, and users whose DID has not yet been created.
No test sends an OTP or writes production data.
