import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "../lib/authenticatedConvex";
import { randomId } from "../lib/randomId";
import { PublicDisplayNameEditor } from "./PublicDisplayNameEditor";

const button = "min-h-11 rounded-full border border-stone-300 dark:border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-600";
const primary = `${button} bg-amber-500 border-amber-500 text-white hover:bg-amber-600`;
const input = "min-h-11 w-full rounded-xl border border-stone-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-2 focus:outline-amber-600";
type Role = "viewer" | "editor";

export function OwnerInvitations({ listId, embedded = false }: { listId: Id<"lists">; embedded?: boolean }) {
  const profile = useQuery(api.users.getMyPublicDisplayName, {});
  const canSend = !!profile?.displayName;
  const invitations = useQuery(api.invitations.getListInvitations, { listId });
  const publication = useQuery(api.publication.getPublicationStatus, { listId });
  const grants = useQuery(api.listGrants.getListGrants, { listId });
  const create = useMutation(api.invitations.createInvitation);
  const resend = useMutation(api.invitations.resendInvitation);
  const revoke = useMutation(api.invitations.revokeInvitation);
  const update = useMutation(api.invitations.updateInvitationRole);
  const changeGrant = useMutation(api.listGrants.updateListGrant);
  const revokeGrant = useMutation(api.listGrants.revokeListGrant);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Keep keys through ambiguous network failures; a changed payload gets a new key.
  const requests = useRef(new Map<string, string>());
  function requestId(key: string) {
    if (!requests.current.has(key)) requests.current.set(key, randomId());
    return requests.current.get(key)!;
  }
  async function run(operation: () => Promise<unknown>, success: string | ((value: unknown) => string) = "Changes saved.") {
    setBusy(true); setError(""); setNotice("");
    try { const value = await operation(); setNotice(typeof success === "string" ? success : success(value)); }
    catch (cause) { setError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not save. Check your connection and try again. If you’ve sent several invitations, wait before resending."); }
    finally { setBusy(false); }
  }
  // Preview what Send will do for this email, using rows the owner already sees below.
  const typed = email.trim().toLowerCase();
  const match = typed ? invitations?.find(invite => invite.email === typed) : undefined;
  const liveGrant = match?.status === "accepted" ? grants?.find(grant => grant._id === match.grantId) : undefined;
  const currentRole = liveGrant?.role as Role | undefined;
  const downgrade = currentRole === "editor" && role === "viewer";
  const submitLabel = currentRole ? (currentRole === role ? `Already has ${role} access` : `Change access to ${role}`)
    : match ? "Resend invitation" : "Send invitation";
  return <div className="mt-6">
    {!embedded && <div className="mb-5 space-y-2 text-sm" role="status">
      <p>{publication === undefined ? "Loading publication status…" : publication?.status === "active" ? "Published publicly: anyone with the link can read this list." : "Not published publicly: only the owner and people with accepted grants have access."}</p>
      <p>Adding or removing named access does not change publication. Removing a grant does not stop public reading while publication is active. Unpublish to end public access; other accepted grants remain.</p>
      {publication?.status === "active" && <Link className="underline" to={`/list/${listId}`} state={{ openShare: true }}>Manage public publication</Link>}
    </div>}
    <p className="mb-5 text-sm">Only you can see the full recipient list. Independent copies and exports survive revocation and cannot be recalled. Copies do not inherit recipients or publication settings.</p>
    <PublicDisplayNameEditor profile={profile} />
    {profile?.displayName && <p className="mt-4 text-sm">Invitations identify you as <strong>{profile.displayName}</strong>.</p>}
    <form className="mt-6 space-y-4" onSubmit={e => {
      e.preventDefault();
      if (!canSend || busy) return;
      const key = `create:${email.trim().toLowerCase()}:${role}`;
      const recipient = email.trim();
      void run(async () => {
        const created = await create({ listId, email, role, requestId: requestId(key) });
        // A completed send is final; sending to the same person again is a new request.
        requests.current.delete(key);
        setEmail("");
        return created;
      }, value => {
        const outcome = (value as { outcome?: string } | null)?.outcome;
        if (outcome === "roleUpdated") return `${recipient} already had access. Their access is now ${role}.`;
        if (outcome === "unchanged") return `${recipient} already has ${role} access. No email was sent.`;
        return "Invitation recorded. Check its status below.";
      });
    }}>
      <div><label className="block text-sm font-semibold mb-1" htmlFor="recipient-email">Recipient email</label>
        <input id="recipient-email" type="email" autoComplete="email" required maxLength={254} className={input} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} placeholder="friend@example.com" /></div>
      <div><label className="block text-sm font-semibold mb-1" htmlFor="invitation-role">Access</label>
        <select id="invitation-role" className={input} value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy}>
          <option value="viewer">Viewer — read only</option><option value="editor">Editor — view and edit</option>
        </select></div>
      {currentRole && <p role="note" className={`text-sm ${downgrade ? "text-amber-800 dark:text-amber-300" : "text-stone-600 dark:text-gray-400"}`}>
        Already has {currentRole} access{downgrade ? ". This lowers their access from editor to viewer." : currentRole === role ? "." : `. This changes it to ${role}; no email is sent.`}
      </p>}
      {match && !currentRole && <p role="note" className="text-sm text-stone-600 dark:text-gray-400">Already invited. Sending again emails a new link and earlier links stop working.</p>}
      <button className={primary} disabled={busy || !canSend || !email.trim() || currentRole === role}>{submitLabel}</button>
      <p className="text-sm text-stone-600 dark:text-gray-400">Expires in seven days. Emails contain no list or note content.</p>
    </form>
    {error && <p role="alert" className="mt-4 text-red-700 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="mt-4">{notice}</p>}
    <h3 className="mt-8 text-lg font-semibold">Invitations sent</h3>
    {invitations === undefined ? <p role="status">Loading invitations…</p> : invitations.length === 0 ? <p className="mt-3 text-stone-600 dark:text-gray-400">Your invitations will appear here with their delivery status.</p> : <ul className="divide-y divide-stone-200 dark:divide-gray-800">
      {invitations.map(invite => <li key={invite.invitationId} className="py-4 space-y-2">
        <p className="font-semibold break-all">{invite.email}</p>
        <p className="text-sm capitalize">{invite.status === "accepted" && grants !== undefined && !grants.some(grant => grant._id === invite.grantId) ? "Access ended (revoked or left)" : invite.status} · {invite.role} · {invite.delivery === "failed" ? "Email failed — resend to retry" : invite.delivery === "sent" ? "Email sent" : "Email queued"}</p>
        <p className="text-sm text-stone-600 dark:text-gray-400">Expires {new Date(invite.expiresAt).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2">
          {invite.status === "pending" && <select className={`${input} w-auto`} aria-label={`Role for ${invite.email}`} disabled={busy} value={invite.role} onChange={e => void run(() => update({ listId, invitationId: invite.invitationId, version: invite.version, role: e.target.value as Role }))}>
            <option value="viewer">Viewer</option><option value="editor">Editor</option>
          </select>}
          {(invite.status !== "accepted" || !grants?.some(g => g._id === invite.grantId)) && <button className={button} disabled={busy || !canSend || grants === undefined} onClick={() => void run(() => resend({ listId, invitationId: invite.invitationId, version: invite.version, requestId: requestId(`resend:${invite.invitationId}:${invite.version}`) }), "New invitation queued. Earlier links no longer work.")}>Resend</button>}
          {(invite.status === "pending" || invite.status === "expired") && <button className={button} disabled={busy} onClick={() => void run(() => revoke({ listId, invitationId: invite.invitationId, version: invite.version }))}>Revoke invitation</button>}
        </div>
      </li>)}
    </ul>}
    <h3 className="mt-8 text-lg font-semibold">Accepted access</h3>
    {grants === undefined ? <p role="status">Loading access…</p> : grants.length === 0 ? <p className="mt-3 text-stone-600 dark:text-gray-400">No accepted invitations yet.</p> : <ul className="divide-y divide-stone-200 dark:divide-gray-800">
      {grants.map(grant => {
        const label = invitations?.find(invite => invite.grantId === grant._id)?.email ?? `Account ${grant.recipientId}`;
        return <li key={grant._id} className="py-4 space-y-2"><p className="break-all font-semibold">{label}</p>
          <div className="flex flex-wrap gap-2"><select aria-label={`Access for ${label}`} className={`${input} w-auto`} disabled={busy} value={grant.role} onChange={e => void run(() => changeGrant({ listId, grantId: grant._id, role: e.target.value as Role }))}>
            <option value="viewer">Viewer</option><option value="editor">Editor</option>
          </select><button className={button} disabled={busy} onClick={() => void run(() => revokeGrant({ listId, grantId: grant._id }), "Named access revoked. Previous invitation links cannot restore it. If publication is active, this person can still read publicly.")}>Revoke access</button></div>
        </li>;
      })}
    </ul>}
  </div>;
}

