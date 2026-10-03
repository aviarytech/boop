/**
 * Legacy join page - redirects to the list view.
 * Invite-based joining has been replaced by publication-based sharing.
 */

import { Link } from "react-router-dom";

export function JoinList() {
  return (
    <div className="max-w-md mx-auto text-center py-12 bg-cream-50 rounded-lg shadow p-6">
      <div className="text-5xl mb-4">🔗</div>
      <h2 className="text-xl font-semibold text-amber-900 mb-2">
        Invite Links No Longer Supported
      </h2>
      <p className="text-amber-700 mb-4">
        Sharing now uses published list links. Ask the list owner to share the new link with you.
      </p>
      <Link to="/" className="text-amber-600 hover:text-amber-700 font-medium">
        Go to your lists
      </Link>
    </div>
  );
}
