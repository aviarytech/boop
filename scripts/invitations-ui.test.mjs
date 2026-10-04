import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import("react");
const { render, fireEvent, screen, cleanup, waitFor } = await import("@testing-library/react");
const { MemoryRouter, Routes, Route } = await import("react-router-dom");
const id = "a".repeat(32);
const state = globalThis.__invitationUi = { revision: 0, listeners: new Set() };
state.subscribe = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
state.notify = () => { state.revision++; for (const listener of state.listeners) listener(); };
const pending = { invitationId: id, version: 1, inviter: "Alex", role: "viewer", expiresAt: Date.now() + 86400000 };
function reset() {
  Object.assign(state, { calls: [], queries: [], fail: false, mutationError: null, profile: { displayName: "Alex" }, pending: [pending], linked: pending,
    lists: [{ _id: "L", name: "My list", ownerDid: "did:owner" }, { _id: "N", name: "My note", kind: "note", ownerDid: "did:owner" }, { _id: "X", name: "Someone else's list", ownerDid: "did:other" }],
    publication: null, invitations: [{ ...pending, email: "friend@example.test", status: "pending", delivery: "failed" }], grants: [],
  });
}
await build({ entryPoints: ["src/pages/Invitations.tsx"], outfile: "tmp/invitation-ui.mjs", bundle: true, jsx: "automatic", platform: "node", format: "esm", external: ["react", "react/jsx-runtime", "react-router-dom", "convex/server", "convex/values"],
  plugins: [{ name: "invitation-ui-fixtures", setup(b) {
    b.onResolve({ filter: /lib\/authenticatedConvex$/ }, () => ({ path: "convex", namespace: "fixture" }));
    b.onResolve({ filter: /hooks\/useCurrentUser$/ }, () => ({ path: "user", namespace: "fixture" }));
    b.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onResolve({ filter: /^\.\/Login$/ }, () => ({ path: "login", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: {
      user: 'export const useCurrentUser=()=>({did:"did:owner",email:"owner@example.test"});',
      auth: 'export const useAuth=()=>({logout:async()=>{globalThis.__invitationUi.calls.push(["logout"]);}});',
      login: 'import React from "react"; export const Login=({embedded})=>React.createElement("p",null,embedded?"Embedded email sign-in":"Other sign-in");',
      convex: `import {ConvexError} from "convex/values"; import {useSyncExternalStore} from "react"; import {getFunctionName} from "convex/server";
        export function useQuery(ref,args){const s=globalThis.__invitationUi;useSyncExternalStore(s.subscribe,()=>s.revision);const name=getFunctionName(ref);s.queries.push([name,args]);
          return {"invitations:getPendingInvitations":s.pending,"invitations:getInvitation":s.linked,"lists:getUserLists":s.lists,"invitations:getListInvitations":s.invitations,"listGrants:getListGrants":s.grants,"users:getMyPublicDisplayName":s.profile,"publication:getPublicationStatus":s.publication}[name];}
        export function useMutation(ref){return async args=>{const s=globalThis.__invitationUi; const name=getFunctionName(ref);s.calls.push([name,args]);if(s.fail)throw Error("network fixture");if(s.mutationError)throw new ConvexError(s.mutationError);if(name==="users:setPublicDisplayName"){s.profile={displayName:args.displayName.trim()};s.notify();return s.profile;}return {listId:"accepted-list"};};}`,
    }[path] }));
  } }],
});
const { Invitations, InvitationSignIn } = await import(pathToFileURL(`${process.cwd()}/tmp/invitation-ui.mjs`));
const mount = (path = "/invitations") => render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Routes, null,
  React.createElement(Route, { path: "/invitations", element: React.createElement(Invitations) }),
  React.createElement(Route, { path: "/invitations/:invitationId/:version", element: React.createElement(Invitations) }),
  React.createElement(Route, { path: "/list/:id", element: React.createElement("p", null, "Accepted resource opened") }),
)));
afterEach(cleanup);

test("email route previews once, never autoaccepts, and explicit acceptance opens the resource", async () => {
  reset(); mount(`/invitations/${id}/1`);
  assert.equal(screen.getAllByRole("button", { name: "Accept invitation" }).length, 1);
  assert.equal(state.calls.length, 0);
  assert.match(screen.getByText("Alex invited you").textContent, /Alex/);
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  await screen.findByText("Accepted resource opened");
  assert.deepEqual(state.calls, [["invitations:acceptInvitation", { invitationId: id, version: 1, accept: true }]]);
});

test("unavailable and malformed links cannot present acceptance; pending inbox remains available", () => {
  reset(); state.linked = null; state.pending = []; mount(`/invitations/${id}/1`);
  assert.equal(screen.queryByRole("button", { name: "Accept invitation" }), null);
  assert.match(screen.getByRole("status").textContent, /unavailable for this account/);
  cleanup(); state.queries = []; mount("/invitations/bad/NaN");
  assert.equal(state.queries.some(([name]) => name === "invitations:getInvitation"), false);
  assert.match(screen.getByRole("status").textContent, /link is unavailable/);
});

test("sign-in is embedded, preserving the invitation route for existing and new accounts", () => {
  render(React.createElement(InvitationSignIn));
  assert.ok(screen.getByText("Embedded email sign-in"));
  assert.match(screen.getByText(/Sign in with the email address/).textContent, /before accepting/);
});

test("owner chooses only owned resources; sends default viewer and retains retry key after network failure", async () => {
  reset(); state.fail = true; mount();
  assert.equal(screen.queryByRole("option", { name: "Someone else's list" }), null);
  fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
  assert.equal(screen.getByLabelText("Access").value, "viewer");
  assert.ok(screen.getByText(/Email failed — resend to retry/));
  fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "new@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await screen.findByRole("alert");
  const first = state.calls[0];
  assert.equal(first[0], "invitations:createInvitation");
  assert.equal(first[1].role, "viewer");
  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await screen.findByText(/Invitation recorded/);
  assert.deepEqual(state.calls[1], first);
});

test("owner resend, pending-role changes and revoke use the current version", async () => {
  reset(); mount();
  fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
  fireEvent.click(screen.getByRole("button", { name: "Resend" }));
  await screen.findByText(/New invitation queued/);
  assert.equal(state.calls[0][0], "invitations:resendInvitation");
  assert.equal(state.calls[0][1].version, 1);
  fireEvent.change(screen.getByLabelText("Role for friend@example.test"), { target: { value: "editor" } });
  await waitFor(() => assert.equal(state.calls.length, 2));
  assert.deepEqual(state.calls[1], ["invitations:updateInvitationRole", { listId: "L", invitationId: id, version: 1, role: "editor" }]);
  fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
  await waitFor(() => assert.equal(state.calls.length, 3));
  assert.equal(state.calls[2][0], "invitations:revokeInvitation");
});

test("accepted access uses account grant controls and never resends an active accepted grant", async () => {
  reset(); state.invitations[0] = { ...state.invitations[0], status: "accepted", grantId: "G" };
  state.grants = [{ _id: "G", recipientId: "U", role: "viewer" }]; mount();
  fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
  assert.equal(screen.queryByRole("button", { name: "Resend" }), null);
  fireEvent.change(screen.getByLabelText("Access for friend@example.test"), { target: { value: "editor" } });
  await screen.findByText("Changes saved.");
  assert.deepEqual(state.calls[0], ["listGrants:updateListGrant", { listId: "L", grantId: "G", role: "editor" }]);
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
  await screen.findByText(/Named access revoked/);
  assert.equal(state.calls[1][0], "listGrants:revokeListGrant");
});


test("send and resend preserve distinct retry IDs when crypto.randomUUID is unavailable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    reset(); state.fail = true; mount();
    fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByRole("alert");
    const send = state.calls[0];
    assert.equal(send[0], "invitations:createInvitation");
    assert.match(send[1].requestId, /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    state.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByText(/Invitation recorded/);
    assert.deepEqual(state.calls[1], send);

    state.fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await screen.findByRole("alert");
    const resend = state.calls[2];
    assert.equal(resend[0], "invitations:resendInvitation");
    assert.match(resend[1].requestId, /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    assert.notEqual(resend[1].requestId, send[1].requestId);
    state.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await screen.findByText(/New invitation queued/);
    assert.deepEqual(state.calls[3], resend);
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else delete crypto.randomUUID;
  }
});


test("missing or loading public name blocks send and resend without blocking revocation", async () => {
  for (const profile of [undefined, { displayName: null }]) {
    reset(); state.profile = profile; mount();
    fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "new@example.test" } });
    assert.equal(screen.getByRole("button", { name: "Send invitation" }).disabled, true);
    assert.equal(screen.getByRole("button", { name: "Resend" }).disabled, true);
    assert.equal(screen.getByLabelText("Public display name").value, "");
    fireEvent.submit(screen.getByRole("button", { name: "Send invitation" }).closest("form"));
    assert.deepEqual(state.calls, []);
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    await screen.findByText("Changes saved.");
    assert.equal(state.calls[0][0], "invitations:revokeInvitation");
    cleanup();
  }
});

test("inline public-name setup explains disclosure, rejects invalid names and enables explicit sending only after save", async () => {
  reset(); state.profile = { displayName: null }; mount();
  fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
  assert.match(screen.getByText(/Choose a name people you invite/).textContent, /This name is public.*Your account email stays private/);
  fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "new@example.test" } });
  for (const name of ["boop user", "alex@example.test", "Account locked - verify at evil.example/reset", "ｅｖｉｌ．ｅｘａｍｐｌｅ", "evil。1"]) {
    fireEvent.change(screen.getByLabelText("Public display name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
    await screen.findByRole("alert");
    assert.deepEqual(state.calls, []);
  }
  fireEvent.change(screen.getByLabelText("Public display name"), { target: { value: "Alex Rivera" } });
  state.fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
  await screen.findByText(/Could not save your name/);
  assert.equal(screen.getByRole("button", { name: "Send invitation" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "Resend" }).disabled, true);
  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
  await screen.findByText(/Public name saved/);
  assert.equal(screen.getByLabelText("Public display name").value, "Alex Rivera");
  assert.equal(screen.getByRole("button", { name: "Send invitation" }).disabled, false);
  assert.equal(screen.getByRole("button", { name: "Resend" }).disabled, false);
  assert.ok(state.calls.every(([name]) => name === "users:setPublicDisplayName"));
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await screen.findByText(/Invitation recorded/);
  assert.equal(state.calls.at(-1)[0], "invitations:createInvitation");
});


test("invitation form displays actionable server email and rate-limit messages", async () => {
  for (const message of ["Enter a valid email address.", "Invitation rate limit reached. Try again later."]) {
    reset(); state.mutationError = message; mount();
    fireEvent.change(screen.getByLabelText("Your list or note"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "a@b" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send invitation" }).closest("form"));
    assert.equal((await screen.findByRole("alert")).textContent, message);
    assert.equal(state.calls[0][0], "invitations:createInvitation");
    assert.equal(screen.getByLabelText("Recipient email").value, "a@b");
    cleanup();
  }
});


test("Share with people preselects only an owned list and reports public access during grant revocation", async () => {
  reset(); state.publication = { status: "active" }; state.grants = [{ _id: "G", recipientId: "recipient", role: "editor" }];
  mount("/invitations?listId=L");
  assert.equal(screen.getByLabelText("Your list or note").value, "L");
  assert.ok(screen.getByText(/Published publicly: anyone/));
  assert.match(screen.getByText(/Adding or removing named access/).textContent, /does not stop public reading/);
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
  await screen.findByText(/Named access revoked/);
  assert.deepEqual(state.calls, [["listGrants:revokeListGrant", { listId: "L", grantId: "G" }]]);
  assert.match(screen.getByText(/Named access revoked/).textContent, /still read publicly/);
  cleanup(); reset(); mount("/invitations?listId=X");
  assert.equal(screen.getByLabelText("Your list or note").value, "");
  assert.equal(screen.queryByLabelText("Recipient email"), null);
});
