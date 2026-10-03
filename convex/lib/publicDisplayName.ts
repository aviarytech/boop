import type { Doc } from "../_generated/dataModel";

/** Public attribution must not reveal the email-derived default of old signups.
 * Mask at read time; private self profiles and stored names stay unchanged. */
export function publicDisplayName(
  user: Pick<Doc<"users">, "displayName" | "email"> | null | undefined,
): string | null {
  if (!user || user.displayName === user.email?.split("@")[0]) return null;
  return user.displayName ?? null;
}
