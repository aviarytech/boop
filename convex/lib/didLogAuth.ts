/**
 * Binds a DID log write to the caller's own identity.
 *
 * A did:webvh log is what the world resolves to learn a user's keys, so the
 * write path must not take the target identity on trust. It doesn't have to:
 * the client derives its serving path as `user-<first 16 of subOrgId>`
 * (toUserSlug in src/lib/webvh.ts) and mints did:webvh:<scid>:<domain>:<path>,
 * so both are recomputable from the JWT alone.
 *
 * Duplicated rather than imported because Convex modules cannot reach into
 * src/ — keep in step with toUserSlug; the test asserts they agree.
 */

export class DidLogOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DidLogOwnershipError";
  }
}

/** The only path this sub-org may serve a DID log at. */
export function didLogPathForSubOrg(subOrgId: string): string {
  return `user-${subOrgId.slice(0, 16)}`;
}

/**
 * Throws unless `userDid` and `path` are the ones this sub-org owns.
 *
 * Matches the DID's trailing path as a whole segment (`:<slug>`) rather than
 * parsing by index, so a dev domain carrying a port (`localhost%3A5173`) still
 * binds and `evil<slug>` still doesn't.
 */
export function assertDidLogOwnership(params: {
  subOrgId: string;
  userDid: string;
  path: string;
}): void {
  const { subOrgId, userDid, path } = params;

  if (!subOrgId) {
    throw new DidLogOwnershipError("Authenticated caller has no sub-organization ID");
  }

  const expectedPath = didLogPathForSubOrg(subOrgId);

  if (path !== expectedPath) {
    throw new DidLogOwnershipError(
      `Path "${path}" is not this account's DID log path`
    );
  }

  if (!userDid.startsWith("did:webvh:")) {
    throw new DidLogOwnershipError(`Expected a did:webvh, got "${userDid}"`);
  }

  if (!userDid.endsWith(`:${expectedPath}`)) {
    throw new DidLogOwnershipError(
      `DID "${userDid}" does not belong to this account`
    );
  }
}
