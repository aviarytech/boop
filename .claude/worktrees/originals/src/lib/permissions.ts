/**
 * Permission helpers.
 * With publication-based sharing, permissions are simple:
 * - Owner: full control
 * - Published list: anyone can edit
 */

/**
 * Check if user is the owner of the list.
 */
export function isOwner(listOwnerDid: string, userDid: string, legacyDid?: string): boolean {
  if (listOwnerDid === userDid) return true;
  if (legacyDid && listOwnerDid === legacyDid) return true;
  return false;
}

/**
 * Get role description for UI.
 */
export function getRoleDescription(role: string): string {
  switch (role) {
    case "owner":
      return "Full control: can edit items, share, and delete the list";
    case "editor":
      return "Can add, check, and remove items";
    default:
      return "";
  }
}
