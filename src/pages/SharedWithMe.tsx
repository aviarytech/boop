import { useState } from "react";
import { Link } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "../lib/authenticatedConvex";

type SharedResource = FunctionReturnType<typeof api.listGrants.getSharedWithMe>[number];
const button = "min-h-11 rounded-full border border-stone-300 dark:border-gray-700 px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber-600";

function SharedResourceRow({ resource, onLeft }: { resource: SharedResource; onLeft: (name: string) => void }) {
  const leave = useMutation(api.listGrants.leaveList);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function leaveNow() {
    setBusy(true); setError(false);
    try {
      await leave({ listId: resource.listId });
      onLeft(resource.name);
    } catch { setError(true); setBusy(false); }
  }
  return <li className="py-6 border-b border-stone-200 dark:border-gray-800">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Link className="text-xl font-semibold underline-offset-4 hover:underline break-words" to={`/${resource.kind === "note" ? "n" : "list"}/${resource.listId}`}>{resource.name}</Link>
        <p className="mt-2 text-sm break-words">{resource.kind === "note" ? "Note" : "List"} · Shared by {resource.owner}</p>
        <p className="mt-1 text-sm text-stone-600 dark:text-gray-400">{resource.role === "editor" ? "Editor · View and edit content" : "Viewer · Read only"}</p>
        <p className="mt-2 text-sm">{resource.published ? "Published publicly · Anyone with the link can also read" : "Private · Accepted people only"}</p>
      </div>
      {!confirm && <button className={button} onClick={() => setConfirm(true)}>Leave</button>}
    </div>
    {confirm && <div className="mt-4 space-y-3" role="group" aria-label={`Leave ${resource.name}`}>
      <p className="text-sm">Leaving removes your named access and this Shared with me entry. It does not delete the owner’s data. Old invitation links cannot restore access; ask the owner for a new invitation.</p>
      {resource.published && <p className="text-sm">You can still read through public links while publication is active.</p>}
      <div className="flex gap-3"><button className={button} disabled={busy} onClick={() => void leaveNow()}>{busy ? "Leaving…" : "Confirm leave"}</button><button className={button} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div>
    </div>}
    {error && <p role="alert" className="mt-3 text-red-700 dark:text-red-400">Could not leave. Check your connection and try again.</p>}
  </li>;
}

export function SharedWithMe() {
  const resources = useQuery(api.listGrants.getSharedWithMe, {});
  const [left, setLeft] = useState<string | null>(null);
  return <div className="mx-auto max-w-2xl text-stone-900 dark:text-gray-100">
    <Link to="/d" className="text-sm underline underline-offset-4">Back to todos</Link>
    <h1 className="mt-5 text-3xl font-bold tracking-tight">Shared with me</h1>
    <p className="mt-3 text-stone-600 dark:text-gray-400">Lists and notes you’ve accepted appear here automatically. Only owners can rename, publish, delete, or manage other people’s access.</p>
    <Link to="/invitations" className="inline-block mt-4 min-h-11 py-2 font-semibold underline underline-offset-4">Review pending invitations</Link>
    {left && <p role="status" className="mt-4">You left “{left}”. The owner’s data is unchanged.</p>}
    {resources === undefined ? <p role="status" className="mt-6">Loading shared resources…</p> : resources.length === 0 ? <p className="mt-6">Nothing shared with you yet. Accept an invitation to see it here. Resources disappear when you leave, access is revoked, or the owner deletes them.</p> : <ul className="mt-2">{resources.map(resource => <SharedResourceRow key={resource.listId} resource={resource} onLeft={setLeft} />)}</ul>}
    <p className="mt-8 text-sm text-stone-600 dark:text-gray-400">Your access is private to you and the owner; other recipients are not listed. Independent copies and exports survive revocation and cannot be recalled. Copies do not inherit recipients or publication settings.</p>
  </div>;
}
