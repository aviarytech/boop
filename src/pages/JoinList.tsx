/**
 * Legacy join page - redirects to the list view.
 * Invite-based joining has been replaced by publication-based sharing.
 */

import { Link } from "react-router-dom";

export function JoinList() {
  return (
    <div className="max-w-md mx-auto text-center py-12 bg-stone-50 dark:bg-gray-900 rounded-lg shadow p-6">
      <div className="text-5xl mb-4">🔗</div>
      <h2 className="text-xl font-semibold text-stone-900 dark:text-gray-100 mb-2">
        Invite Links No Longer Supported
      </h2>
      <p className="text-stone-600 dark:text-gray-300 mb-4">
        Sharing now uses published list links. Ask the list owner to share the new link with you.
      </p>
      <Link to="/" className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium">
        Go to your lists
      </Link>
    </div>
  );
}
