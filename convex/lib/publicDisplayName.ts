import type { Doc } from "../_generated/dataModel";

/** Public attribution must not reveal the email-derived default of old signups.
 * Mask at read time; private self profiles and stored names stay unchanged. */
export function publicDisplayName(
  user: Pick<Doc<"users">, "displayName" | "email"> | null | undefined,
): string | null {
  if (!user || user.displayName === user.email?.split("@")[0]) return null;
  return user.displayName ?? null;
}


/** A recognizable name is a user choice, not an inference from private identity.
 * Keep validation shared with the editor; never echo a rejected value in errors. */
export function displayNameError(value: string, email?: string): string | null {
  const name = value.trim().normalize("NFKC");
  if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)
    || /[@\p{Cc}\p{Cf}]/u.test(name)
    || /^(boopuser|anonymous|unknown|user)$/i.test(name.replace(/\s/g, ""))) {
    return "Choose a recognizable name of 2–80 characters, without an email address or hidden characters.";
  }
  // Detect after NFKC so full-width URL punctuation cannot bypass the rule.
  // IDNA also treats ideographic/half-width full stops as domain separators.
  // Periods must end a word: spaced initials and suffixes remain usable,
  // while every adjacent domain label (including single letters/digits) fails.
  if (/[:/\\]/u.test(name) || /www[.\u3002\uff61]/iu.test(name)
    || /[.\u3002\uff61](?=\S)/u.test(name)) {
    return "Choose a name without links, web addresses or URL punctuation.";
  }
  if (email && name.toLowerCase() === email.split("@")[0].trim().normalize("NFKC").toLowerCase()) {
    return "Choose a name different from the first part of your email address to keep it private.";
  }
  return null;
}

export function chosenPublicDisplayName(
  user: Pick<Doc<"users">, "displayName" | "email" | "displayNameChosenAt"> | null | undefined,
): string | null {
  const name = publicDisplayName(user);
  return user?.displayNameChosenAt !== undefined && name && !displayNameError(name, user.email)
    ? name.trim().normalize("NFKC") : null;
}
