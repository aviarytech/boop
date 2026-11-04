/**
 * Retired legacy join links do not grant access. Direct people to current invitations.
 */

import { Link } from "react-router-dom";
import { Icon } from "../components/ui/Icon";

export function JoinList() {
  return (
    <div className="boop-sheet max-w-md mx-auto mt-12 text-center p-8">
      <Icon name="link" className="mx-auto mb-4 w-10 h-10 text-[var(--boop-accent)]" />
      <h2 className="text-xl font-semibold text-[var(--boop-ink)] mb-2">
        This legacy invite link is no longer supported
      </h2>
      <p className="text-[var(--boop-muted)] mb-4">
        Ask the owner to invite your email as a viewer or editor through Share with people. Accept the invitation to get named access. A public list link allows reading only; it does not grant editing.
      </p>
      <Link to="/" className="text-[var(--boop-accent)] hover:text-[var(--boop-accent-deep)] font-medium">
        Go to your lists
      </Link>
    </div>
  );
}
