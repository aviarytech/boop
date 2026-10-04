import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import("react");
const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const state = globalThis.__publicationUi = { publication: null, calls: [] };
await build({
  entryPoints: { ShareModal: "src/components/ShareModal.tsx", "publish/PublishModal": "src/components/publish/PublishModal.tsx", JoinList: "src/pages/JoinList.tsx" },
  outdir: "tmp/publication-ui", bundle: true, jsx: "automatic", platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  external: ["react", "react/jsx-runtime", "react-router-dom", "convex/server"],
  plugins: [{ name: "publication-ui-fixtures", setup(b) {
    b.onResolve({ filter: /(?:lib\/(authenticatedConvex|webvh|share|analytics|originals)|hooks\/(useCurrentUser|useSettings)|ui\/Panel|ProvenanceInfo)$/ }, ({ path }) => ({ path: path.split("/").pop(), namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: {
      authenticatedConvex: `import {getFunctionName} from "convex/server";
        export const useQuery=ref=>({"publication:getPublicationStatus":globalThis.__publicationUi.publication,"invitations:getListInvitations":[],"listGrants:getListGrants":[],"users:getMyPublicDisplayName":{displayName:"Owner"}}[getFunctionName(ref)]);
        export const useMutation=ref=>async args=>{globalThis.__publicationUi.calls.push([getFunctionName(ref),args]);};`,
      useCurrentUser: 'export const useCurrentUser=()=>({did:"did:owner",subOrgId:"owner"});',
      useSettings: 'export const useSettings=()=>({haptic:()=>{}});',
      webvh: 'export const buildListResourceDid=(did,id)=>`${did}/resources/list-${id}`;export const buildListResourceUrl=()=>"https://fixture.invalid/owner/resources/list-L";',
      share: 'export const canShare=async()=>false;export const shareList=async()=>{};',
      analytics: 'export const trackListShared=()=>{};export const trackInviteSent=()=>{};',
      originals: 'export const buildListSnapshot=()=>({});export const recordPublishedVersion=async()=>({});export class ListNotAuthorableError extends Error {}',
      Panel: 'import React from "react";export const Panel=({header,footer,children})=>React.createElement("div",null,header,children,footer);',
      ProvenanceInfo: 'export const ListProvenanceInfo=()=>null;',
    }[path] }));
  } }],
});
const { ShareModal } = await import(pathToFileURL(`${process.cwd()}/tmp/publication-ui/ShareModal.mjs`));
const { PublishModal } = await import(pathToFileURL(`${process.cwd()}/tmp/publication-ui/publish/PublishModal.mjs`));
const mount = Component => render(React.createElement(MemoryRouter, null, React.createElement(Component, { list: { _id: "L", name: "Groceries" }, onClose() {} })));
afterEach(() => { cleanup(); state.calls = []; state.publication = null; });

test("Share with people embeds the selected owner invitation controls without publishing", () => {
  mount(ShareModal);
  assert.ok(screen.getByRole("heading", { name: "Share with people" }));
  assert.ok(screen.getByRole("heading", { name: "Publish publicly" }));
  assert.ok(screen.getByLabelText("Recipient email"));
  assert.match(screen.getByText(/Invite someone by email/).textContent, /must accept/);
  assert.deepEqual(state.calls, []);
});

for (const Component of [ShareModal, PublishModal]) {
  test(`${Component.name}: publication explicitly grants reading only; unpublish changes publication alone`, async () => {
    state.publication = { status: "active", webvhDid: "did:owner/resources/list-L" };
    mount(Component);
    assert.equal(screen.queryByRole("link", { name: "Manage public publication" }), null);
    assert.match(screen.getByText(/Anyone with the link can read this list/).textContent, /accepted editors/);
    assert.match(screen.getByText(/Removing a named grant|Named access is separate/).textContent, /does not stop public reading/);
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await waitFor(() => assert.deepEqual(state.calls, [["publication:unpublishList", { listId: "L" }]]));
  });
  test(`${Component.name}: publishing is an explicit separate mutation`, async () => {
    mount(Component);
    fireEvent.click(screen.getByRole("button", { name: "Publish publicly" }));
    await waitFor(() => assert.equal(state.calls.length, 1));
    assert.equal(state.calls[0][0], "publication:publishList");
    assert.equal(state.calls[0][1].listId, "L");
  });
}

test("Share modal never offers publishing before publication status has loaded", () => {
  state.publication = undefined; mount(ShareModal);
  assert.match(screen.getByRole("status").textContent, /Loading publication/);
  assert.equal(screen.queryByRole("button", { name: "Publish publicly" }), null);
});


test("retired legacy join links explain the owner invitation path instead of public collaboration", async () => {
  const { JoinList } = await import(pathToFileURL(`${process.cwd()}/tmp/publication-ui/JoinList.mjs`));
  mount(JoinList);
  assert.match(screen.getByText(/Ask the owner to invite your email/).textContent, /Accept the invitation/);
  assert.match(screen.getByText(/Ask the owner to invite your email/).textContent, /public list link allows reading only/);
});
