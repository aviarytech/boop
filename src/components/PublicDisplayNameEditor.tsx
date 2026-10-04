import { useId, useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { displayNameError } from "../../convex/lib/publicDisplayName";
import { useMutation } from "../lib/authenticatedConvex";

type Profile = { displayName: string | null };

export function PublicDisplayNameEditor({ profile }: { profile: Profile | undefined }) {
  const id = useId();
  const save = useMutation(api.users.setPublicDisplayName);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const name = draft ?? profile?.displayName ?? "";
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    if (busy || profile === undefined) return;
    setError(""); setSaved(false);
    const invalid = displayNameError(name);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const result = await save({ displayName: name });
      setDraft(result.displayName); setSaved(true);
    } catch (cause) {
      setError(cause instanceof ConvexError && typeof cause.data === "string"
        ? cause.data : "Could not save your name. Check your connection and try again.");
    } finally { setBusy(false); }
  }}>
    <label htmlFor={id} className="block text-sm font-semibold">Public display name</label>
    <p id={`${id}-help`} className="text-sm text-stone-600 dark:text-gray-400">Choose a name people you invite will recognize. This name is public: it appears in invitations, invitation emails and shared activity. Your account email stays private. Do not use an email address or its first part.</p>
    {profile === undefined ? <p role="status">Loading public name…</p> : !profile.displayName && <p className="text-sm font-semibold">Save a recognizable name before sending or resending invitations.</p>}
    <input id={id} aria-describedby={`${id}-help`} type="text" autoComplete="nickname" maxLength={80} required
      className="min-h-11 w-full rounded-xl border border-stone-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-2 focus:outline-amber-600"
      value={name} disabled={busy || profile === undefined} onChange={event => { setDraft(event.target.value); setSaved(false); setError(""); }} />
    <button type="submit" disabled={busy || profile === undefined || !name.trim()}
      className="min-h-11 rounded-full border border-stone-300 dark:border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed">{busy ? "Saving name…" : "Save public name"}</button>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    {saved && <p role="status" className="text-sm">Public name saved. Invitations are sent only when you choose Send invitation or Resend.</p>}
  </form>;
}
