# Turnkey custody: who can act in an author's sub-org

Decided on #286: the author's Turnkey Ed25519 key controls the author's did:webvh,
and only the author's own client can use it. boop's backend never signs as a user.

This document says what the code enforces, what it relies on Turnkey to enforce,
and what an operator still has to apply. **The policy guarantee below does not
hold until an operator has applied and checked the policies.** Nothing in
`docs/turnkey/boop-api-user-policies.json` has been submitted to the live
Turnkey API yet.

## What the code does (PR a)

Login is Turnkey's encrypted OTP flow
([OTP migration guide](https://docs.turnkey.com/features/authentication/otp-migration-guide)):

1. `/auth/initiate`: Convex submits `ACTIVITY_TYPE_INIT_OTP_V3` in the parent org
   and returns `otpId`'s enclave encryption target (`otpEncryptionTargetBundle`).
2. The client makes a non-extractable P-256 session key in IndexedDB
   (`@turnkey/core` `createApiKeyPair`; the Capacitor WebView uses the same store)
   and encrypts the code to the enclave together with that public key
   (`encryptOtpCodeToBundle`). That function checks the target bundle's enclave
   signature first, so a server that substitutes its own target is refused.
3. `/auth/verify`: Convex relays the ciphertext with `ACTIVITY_TYPE_VERIFY_OTP_V2`.
   It refuses a plaintext `code` with 426. The verification token Turnkey
   returns is bound to the client's session key. Only now, with the email
   verified, does a new account get a sub-org (`CREATE_SUB_ORGANIZATION_V8`
   with `disableEmailAuth`, `disableEmailRecovery`, `disableSmsAuth`).
4. The client checks the token is bound to its own key and calls `loginWithOtp`,
   an attested `STAMP_LOGIN` sent straight to `api.turnkey.com`, for a 7-day
   session. It refreshes silently when under 2 days remain, never with
   `invalidateExisting` (Turnkey allows 10 expiring keys per user).
5. At every login the client removes `EMAIL_AUTH`, `EMAIL_RECOVERY`,
   `ROOT_USER_EMAIL_RECOVERY` and `SMS_AUTH` from its sub-org (sub-orgs made
   before #286 have them), then audits the sub-org: one user, that user alone in
   the root quorum, no passkeys, OAuth providers or phone number, and no API
   key that outlives a 7-day session. boop creates sub-orgs with no
   credentials, so anything else was put there by someone else, possibly the
   parent at creation. As a tripwire only, the sign-up device's first login
   (its key created within 60 s of the sub-org) also flags any key older than
   its own, and keeps that finding. **This does not stop a compromised
   backend**: see "Residual risk". The result is stored per device
   (`lastSubOrgAudit`); DID updates refuse to sign without a clean audit (PR b).

The server signers (`convex/didCreation.ts`, `convex/lib/turnkeySigner.ts`,
`convex/lib/turnkeyClient.ts`, `convex/turnkeyHelpers.ts`) are deleted. They
could never have signed: a parent-org key cannot stamp sub-org activities
(production logged `organization mismatch`, `7bbba38`).

A Turnkey login failure does not block boop sign-in. It only blocks DID updates
until the next OTP login succeeds.

## What Turnkey has to enforce

The root quorum bypasses policies. So the remaining power that matters is the
parent org's ability to **start** auth and recovery flows into a sub-org where
the parent picks the credential's target key:

| Path | Closed by |
| --- | --- |
| `EMAIL_AUTH` (bundle to a parent-chosen key, link template the parent controls) | sub-org feature removed (new sub-orgs: at creation; old: at the user's next OTP login, retried at each refresh check until it succeeds) and boop API user policy |
| Email recovery | same |
| Legacy `INIT_OTP_AUTH`/`OTP_AUTH`, `INIT_OTP`/`VERIFY_OTP` + `OTP_LOGIN` (plaintext code through the server) | boop API user policy; the client never sends a plaintext code |
| Parent signing, creating users/keys, root-quorum changes in a sub-org | Turnkey itself: the parent cannot stamp sub-org activities |

## Operator runbook (not yet done)

You need parent-org root credentials. Don't run any of this against production
without checking each step in a test parent org first.

1. **Give boop its own non-root API user.** Create an API-only user in the
   parent org, give its key to Convex (`TURNKEY_API_PUBLIC_KEY`,
   `TURNKEY_API_PRIVATE_KEY`), and confirm it is **not** in the parent's root
   quorum. Root users bypass policies, so steps 2 and 3 mean nothing otherwise.
2. **Apply the policies** in `docs/turnkey/boop-api-user-policies.json`
   (`CREATE_POLICY_V3`, or Dashboard → Policies), with `<BOOP_API_USER_ID>`
   replaced by that user's ID.
3. **Check each one against the live API.** For each, record the activity ID:
   - `INIT_OTP_V3`, `VERIFY_OTP_V2` and `CREATE_SUB_ORGANIZATION_V8` succeed as
     boop's API user (a full sign-up and sign-in in staging).
   - `EMAIL_AUTH_V3`, `INIT_OTP_AUTH_V3`, `INIT_OTP`, `INIT_USER_EMAIL_RECOVERY_V2`
     targeting a test sub-org fail with a policy denial.
   - `CREATE_POLICY_V3` with these bodies accepts every `activity.resource` and
     `activity.action` term. **These are the least certain expressions**: if
     one is rejected, remove that term and note it here.
   - Confirm `CREATE_SUB_ORGANIZATION_V8` is not caught by the resource deny
     (it creates a user and wallet inside the new sub-org).
4. **Confirm the server no longer signs.** Nothing in Convex calls
   `SIGN_RAW_PAYLOAD` any more; after deploy, confirm the Turnkey activity log
   shows none from boop's API user.
5. **Existing sub-orgs** keep `EMAIL_AUTH` until their user next signs in. To
   see how many are left, list sub-org features (read-only) for boop's accounts.

### Unvalidated

- Every policy expression in `boop-api-user-policies.json`.
- Whether removing sub-org features through the user's own session succeeds for
  every pre-#286 sub-org (the client records a finding if it does not).
- `VERIFY_OTP_V2` → `loginWithOtp` into a sub-org from a parent-org OTP has been
  tested only against mocks (`scripts/login-account.test.mjs`,
  `scripts/auth-provider.test.mjs`, the E2E fixture), never against Turnkey.

## Residual risk

- **Whoever serves the JS can subvert the client.** A malicious build could send
  the plaintext code, or sign whatever it likes with the session. Device keys in
  PR b have the same limit. This is inherent to a web client.
- **The parent org is shared with other apps** (`docs/login-account-recovery.md`).
  Their API users are not covered by boop's policies. The sub-org feature
  removals cover them for `EMAIL_AUTH` and recovery; any of them holding a
  parent root credential can change policies.
- The client audit runs at login. Something added to the sub-org afterwards is
  found at the next login, not before.
- **A compromised backend can plant a root credential at sign-up, and the
  client does not reliably detect it.** The parent creates the sub-org and
  chooses its root user's credentials, and Turnkey policies can't constrain
  those parameters. A planted session-length API key passes the audit,
  can renew itself (STAMP_LOGIN), and can delete itself after minting a
  successor. The 60 s first-login tripwire is evaded by answering
  `/auth/verify` late or by rotating the key before the audit reads users.
  The robust check is to trace every API key in the sub-org to a STAMP_LOGIN
  chain that starts at one of the user's own OTP logins, from the sub-org's
  activity history. It isn't built: it depends on how Turnkey records
  attested logins and their stampers, which needs the live API to confirm.
  **Until it exists, the custody guarantee holds only if boop's backend was
  honest when each account signed up.** Accounts created before #286 had
  their sub-orgs created with no credentials by the old code.
- **A compromised backend can phish the code through Turnkey's own email.**
  The allow policy permits `INIT_OTP_V3` with any parameters, and its
  `emailCustomization` (magic-link template, template ID and variables),
  sender and reply-to are the parent's to choose. A backend could send a real
  Turnkey OTP email, for any existing account, with a link or wording that
  hands the code to it; with the code it can encrypt it to its own key,
  relay `VERIFY_OTP_V2`, and log in itself. This needs the user to act on a
  misleading email, but is not limited to sign-up. A policy condition
  refusing INIT_OTP_V3 with those parameters set would close it if Turnkey's
  policy language can express it; that is unvalidated, so it isn't in the
  policy file.
- A second device signing in within 60 s of sign-up is flagged by the
  tripwire by mistake, and that device's finding would need clearing by hand.
- Another tab's login, silent refresh or sign-out (logout, boop session
  expiry, a restore finding the token expired) during this tab's
  `/auth/verify` round trip can delete this tab's pending session key: unused
  key pairs are cleared on every session write. Sign-in still succeeds,
  without a Turnkey session until the next login.
- Login, refresh and sign-out share a cross-tab lock held for at most 30 s.
  A login Turnkey answers after that still stores its session; its audit is
  then run by the next refresh check (each login marks the stored audit
  pending first), not at login.
