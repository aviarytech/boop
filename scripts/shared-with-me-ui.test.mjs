import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import("react");
const { render, fireEvent, screen, cleanup, waitFor } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const state = globalThis.__sharedUi = { revision: 0, listeners: new Set() };
state.subscribe = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
state.notify = () => { state.revision++; for (const listener of state.listeners) listener(); };
function reset() { Object.assign(state, { fail: false, calls: [], resources: [
  { listId: "L", name: "Weekend plans", kind: "list", role: "viewer", owner: "Alex", published: true },
  { listId: "N", name: "Meeting note", kind: "note", role: "editor", owner: "Sam", published: false },
] }); }
await build({ entryPoints: ["src/pages/SharedWithMe.tsx"], outfile: "tmp/shared-ui.mjs", bundle: true, jsx: "automatic", platform: "node", format: "esm", external: ["react", "react/jsx-runtime", "react-router-dom", "convex/server"],
  plugins: [{ name: "shared-ui-fixtures", setup(b) {
    b.onResolve({ filter: /lib\/authenticatedConvex$/ }, () => ({ path: "convex", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `import {useSyncExternalStore} from "react";import {getFunctionName} from "convex/server";
      export function useQuery(){const s=globalThis.__sharedUi;useSyncExternalStore(s.subscribe,()=>s.revision);return s.resources;}
      export function useMutation(ref){return async args=>{const s=globalThis.__sharedUi;s.calls.push([getFunctionName(ref),args]);if(s.fail)throw Error('network');s.resources=s.resources.filter(r=>r.listId!==args.listId);s.notify();};}` }));
  } }],
});
const { SharedWithMe } = await import(pathToFileURL(`${process.cwd()}/tmp/shared-ui.mjs`));
const mount = () => render(React.createElement(MemoryRouter, null, React.createElement(SharedWithMe)));
afterEach(cleanup);
test("accepted lists/notes expose own role and owner, route correctly and explain public status and copy consequences", () => {
  reset(); mount();
  assert.equal(screen.getByRole("link", { name: "Weekend plans" }).getAttribute("href"), "/list/L");
  assert.equal(screen.getByRole("link", { name: "Meeting note" }).getAttribute("href"), "/n/N");
  assert.ok(screen.getByText("Viewer · Read only"));
  assert.ok(screen.getByText("Editor · View and edit content"));
  assert.ok(screen.getByText(/Published publicly/));
  assert.ok(screen.getByText(/Private · Accepted people only/));
  assert.ok(screen.getByText(/Independent copies and exports survive/));
  assert.equal(screen.queryByRole("button", { name: /Delete|Rename|Publish|Revoke/ }), null);
});
test("leave requires confirmation, retries failure, removes discovery reactively and preserves the other resource", async () => {
  reset(); mount();
  fireEvent.click(screen.getAllByRole("button", { name: "Leave" })[0]);
  assert.ok(screen.getByText(/does not delete the owner’s data/));
  assert.ok(screen.getByText(/still read through public links/));
  assert.deepEqual(state.calls, []);
  state.fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
  await screen.findByRole("alert");
  assert.ok(screen.getByRole("link", { name: "Weekend plans" }));
  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
  await waitFor(() => assert.equal(screen.queryByRole("link", { name: "Weekend plans" }), null));
  assert.ok(screen.getByRole("link", { name: "Meeting note" }));
  assert.match(screen.getByRole("status").textContent, /owner’s data is unchanged/);
  assert.deepEqual(state.calls[0], ["listGrants:leaveList", { listId: "L" }]);
});
test("loading, empty, cancellation and reactive revocation states remain understandable", () => {
  reset(); state.resources = undefined; mount();
  assert.match(screen.getByRole("status").textContent, /Loading/); cleanup();
  state.resources = []; mount(); assert.ok(screen.getByText(/Nothing shared with you yet/)); cleanup();
  reset(); mount(); fireEvent.click(screen.getAllByRole("button", { name: "Leave" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(screen.queryByRole("button", { name: "Confirm leave" }), null);
  assert.deepEqual(state.calls, []);
});
