import { ConvexError } from "convex/values";
import { PublicDisplayNameEditor } from "../components/PublicDisplayNameEditor";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "../lib/authenticatedConvex";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAuth } from "../hooks/useAuth";
import { randomId } from "../lib/randomId";
import { Login } from "./Login";

const button = "min-h-11 rounded-full border border-stone-300 dark:border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-600";
const primary = `${button} bg-amber-500 border-amber-500 text-white hover:bg-amber-600`;
const input = "min-h-11 w-full rounded-xl border border-stone-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-2 focus:outline-amber-600";
type Invitation = FunctionReturnType<typeof api.invitations.getPendingInvitations>[number];
type Role = "viewer" | "editor";

export function InvitationSignIn() {
  return <div className="bg-stone-50 dark:bg-gray-950 text-stone-900 dark:text-gray-100">
    <div className="mx-auto max-w-lg px-6 pt-10">
      <h1 className="text-2xl font-bold">Your private invitation</h1>
      <p className="mt-3">Sign in with the email address that received the invitation. You’ll review it before accepting.</p>
    </div>
    <Login embedded />
  </div>;
}

function InvitationReview({ invitation }: { invitation: Invitation }) {
  const accept = useMutation(api.invitations.acceptInvitation);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function acceptNow() {
    setBusy(true); setError(false);
    try {
      const accepted = await accept({ invitationId: invitation.invitationId, version: invitation.version, accept: true });
      navigate(`/list/${accepted.listId}`);
    } catch { setError(true); setBusy(false); }
  }
  return <article className="border-b border-stone-200 dark:border-gray-800 py-5">
    <h3 className="text-lg font-semibold break-words">{invitation.inviter} invited you</h3>
    <p className="mt-1 text-stone-600 dark:text-gray-400">{invitation.role === "editor" ? "Editor · View and edit" : "Viewer · Read only"}</p>
    <p className="mt-1 text-sm text-stone-600 dark:text-gray-400">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
    <p className="my-4 text-sm">Accept to open what was shared with you. This invitation does not change public-link access.</p>
    {error && <p role="alert" className="mb-3 text-red-700 dark:text-red-400">Could not accept. This invitation may have changed or expired. Check your pending invitations and try again.</p>}
    <button className={primary} disabled={busy} onClick={() => void acceptNow()}>{busy ? "Accepting…" : "Accept invitation"}</button>
  </article>;
}

function LinkedInvitation({ invitationId, version }: { invitationId: Id<"listInvitations">; version: number }) {
  const invitation = useQuery(api.invitations.getInvitation, { invitationId, version });
  if (invitation === undefined) return <p role="status">Loading invitation…</p>;
  if (!invitation) return <p role="status" className="py-4">This invitation is unavailable for this account. It may have expired, been replaced or already accepted. Check your pending invitations below, or ask the owner to resend it.</p>;
  return <InvitationReview invitation={invitation} />;
}

function OwnerInvitations({ listId }: { listId: Id<"lists"> }) {
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
  async function run(operation: () => Promise<unknown>, success = "Changes saved.") {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(success); }
    catch (cause) { setError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not save. Check your connection and try again. If you’ve sent several invitations, wait before resending."); }
    finally { setBusy(false); }
  }
  return <div className="mt-6">
    <div className="mb-5 space-y-2 text-sm" role="status">
      <p>{publication === undefined ? "Loading publication status…" : publication?.status === "active" ? "Published publicly: anyone with the link can read this list." : "Not published publicly: only the owner and people with accepted grants have access."}</p>
      <p>Adding or removing named access does not change publication. Removing a grant does not stop public reading while publication is active. Unpublish to end public access; other accepted grants remain.</p>
      {publication?.status === "active" && <Link className="underline" to={`/list/${listId}`} state={{ openShare: true }}>Manage public publication</Link>}
    </div>
    <PublicDisplayNameEditor profile={profile} />
    {profile?.displayName && <p className="mt-4 text-sm">Invitations identify you as <strong>{profile.displayName}</strong>.</p>}
    <form className="mt-6 space-y-4" onSubmit={e => {
      e.preventDefault();
      if (!canSend || busy) return;
      void run(async () => {
        await create({ listId, email, role, requestId: requestId(`create:${email.trim().toLowerCase()}:${role}`) });
        setEmail("");
      }, "Invitation recorded. Check its status below; use Resend for an existing invitation.");
    }}>
      <div><label className="block text-sm font-semibold mb-1" htmlFor="recipient-email">Recipient email</label>
        <input id="recipient-email" type="email" autoComplete="email" required maxLength={254} className={input} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} placeholder="friend@example.com" /></div>
      <div><label className="block text-sm font-semibold mb-1" htmlFor="invitation-role">Access</label>
        <select id="invitation-role" className={input} value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy}>
          <option value="viewer">Viewer — read only</option><option value="editor">Editor — view and edit</option>
        </select></div>
      <button className={primary} disabled={busy || !canSend || !email.trim()}>Send invitation</button>
      <p className="text-sm text-stone-600 dark:text-gray-400">Expires in seven days. Emails contain no list or note content.</p>
    </form>
    {error && <p role="alert" className="mt-4 text-red-700 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="mt-4">{notice}</p>}
    <h3 className="mt-8 text-lg font-semibold">Invitations sent</h3>
    {invitations === undefined ? <p role="status">Loading invitations…</p> : invitations.length === 0 ? <p className="mt-3 text-stone-600 dark:text-gray-400">Your invitations will appear here with their delivery status.</p> : <ul className="divide-y divide-stone-200 dark:divide-gray-800">
      {invitations.map(invite => <li key={invite.invitationId} className="py-4 space-y-2">
        <p className="font-semibold break-all">{invite.email}</p>
        <p className="text-sm capitalize">{invite.status} · {invite.delivery === "failed" ? "Email failed — resend to retry" : invite.delivery === "sent" ? "Email sent" : "Email queued"}</p>
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

export function Invitations() {
  const { invitationId, version } = useParams();
  const { email, did, legacyDid } = useCurrentUser();
  const { logout } = useAuth();
  const pending = useQuery(api.invitations.getPendingInvitations, {});
  const lists = useQuery(api.lists.getUserLists, {});
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState(() => searchParams.get("listId") ?? "");
  const owned = lists?.filter(list => [did, legacyDid].includes(list.ownerDid)) ?? [];
  const selectedList = owned.find(list => list._id === selected);
  const validLink = invitationId && /^[a-z0-9]{20,64}$/.test(invitationId) && version && /^[1-9]\d*$/.test(version) && Number.isSafeInteger(Number(version));
  return <div className="mx-auto max-w-2xl text-stone-900 dark:text-gray-100">
    <Link className="text-sm underline underline-offset-4" to="/d">Back to todos</Link>
    <h1 className="mt-5 text-3xl font-bold tracking-tight">Private invitations</h1>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-600 dark:text-gray-400">
      <p className="break-all">Signed in as {email}</p><button className="underline underline-offset-4 min-h-11" onClick={() => void logout()}>Use a different account</button>
    </div>
    {invitationId && <section className="mt-6" aria-label="Invitation from email">
      {validLink ? <LinkedInvitation key={`${invitationId}:${version}`} invitationId={invitationId as Id<"listInvitations">} version={Number(version)} /> : <p role="status">This invitation link is unavailable. Check your pending invitations below.</p>}
    </section>}
    {validLink && pending?.length === 1 && pending[0].invitationId === invitationId && pending[0].version === Number(version) ? null : <section className="mt-8" aria-labelledby="pending-title"><h2 id="pending-title" className="text-xl font-semibold">Waiting for you</h2>
      {pending === undefined ? <p className="mt-4" role="status">Loading pending invitations…</p> : pending.length === 0 ? <p className="mt-4 text-stone-600 dark:text-gray-400">No pending invitations for this email. When someone invites you, it will appear here.</p> : pending.filter(invite => !(validLink && invite.invitationId === invitationId && invite.version === Number(version))).map(invite => <InvitationReview key={`${invite.invitationId}:${invite.version}`} invitation={invite} />)}
    </section>}
    <section className="mt-12 pt-8 border-t border-stone-200 dark:border-gray-800" aria-labelledby="owner-title"><h2 id="owner-title" className="text-xl font-semibold">Invite someone</h2>
      <p className="mt-2 mb-5 text-sm text-stone-600 dark:text-gray-400">Choose a list or note you own to manage invitations and access.</p>
      <label htmlFor="invitation-resource" className="block text-sm font-semibold mb-1">Your list or note</label>
      <select id="invitation-resource" className={input} value={selectedList?._id ?? ""} onChange={e => setSelected(e.target.value)} disabled={lists === undefined}>
        <option value="">Choose a list or note</option>{owned.map(list => <option key={list._id} value={list._id}>{list.name}{list.kind === "note" ? " (note)" : ""}</option>)}
      </select>
      {lists !== undefined && owned.length === 0 && <p className="mt-3">Create a list or note first, then invite someone here.</p>}
      {selectedList && <OwnerInvitations key={selectedList._id} listId={selectedList._id} />}
    </section>
  </div>;
}
