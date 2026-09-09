import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, screen, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const React = await import("react");

const state = globalThis.__sharedListAuthTest = { token: null, did: null };
await build({
  entryPoints: ["src/components/SharedListResource.tsx"],
  outfile: "tmp/shared-list-auth-test.mjs",
  bundle: true,
  jsx: "automatic",
  platform: "node",
  format: "esm",
  define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://test.convex.cloud") },
  external: ["react", "react/jsx-runtime"],
  plugins: [{
    name: "shared-list-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^(react-router-dom|\.\.\/lib\/authenticatedConvex|\.\.\/hooks\/useCurrentUser|\.\.\/hooks\/useAuth)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: ({
        "react-router-dom": `import React from "react";export const useParams=()=>({userPath:"owner",resourceId:"list-list1"});export const Link=({children,to,...props})=>React.createElement("a",{...props,href:to},children);export const useNavigate=()=>()=>{};`,
        "../lib/authenticatedConvex": `export const useMutation=()=>async()=>{};export const useQuery=()=>false;`,
        "../hooks/useCurrentUser": `export const useCurrentUser=()=>({did:globalThis.__sharedListAuthTest.did});`,
        "../hooks/useAuth": `export const useAuth=()=>({token:globalThis.__sharedListAuthTest.token});`,
      })[path] }));
    },
  }],
});

const { SharedListResource } = await import(pathToFileURL(`${process.cwd()}/tmp/shared-list-auth-test.mjs`));
const originalFetch = globalThis.fetch;
const resource = {
  "@context": [], id: "resource", type: "List", controller: "owner", name: "Groceries",
  items: [{ _id: "item1", name: "Milk", checked: false, createdAt: 1 }],
  createdAt: 1, itemCount: 1, checkedCount: 0,
};

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  state.token = null;
  state.did = null;
});

async function renderLoaded(postResponse = new Response(null, { status: 200 })) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return options?.method === "POST" ? postResponse : Response.json(resource);
  };
  render(React.createElement(SharedListResource));
  await screen.findByRole("button", { name: /Milk/ });
  return calls;
}

test("anonymous viewers see a sign-in affordance and cannot send item writes", async () => {
  const calls = await renderLoaded();
  const item = screen.getByRole("button", { name: /Milk/ });
  assert.equal(item.disabled, true);
  assert.match(screen.getByRole("link", { name: "Sign in" }).parentElement.textContent, /check off items/);
  fireEvent.click(item);
  assert.equal(calls.filter(({ options }) => options?.method === "POST").length, 0);
});

test("signed-in item writes send the session token and cross-origin credentials", async () => {
  state.token = "session-token";
  state.did = "did:webvh:owner";
  const calls = await renderLoaded();
  fireEvent.click(screen.getByRole("button", { name: /Milk/ }));
  await waitFor(() => assert.equal(calls.filter(({ options }) => options?.method === "POST").length, 1));
  const request = calls.find(({ options }) => options?.method === "POST");
  assert.equal(request.options.headers.Authorization, "Bearer session-token");
  assert.equal(request.options.credentials, "include");
});

test("a 401 rolls back the optimistic check and shows a visible error", async () => {
  state.token = "expired-token";
  state.did = "did:webvh:owner";
  await renderLoaded(new Response(null, { status: 401 }));
  const item = screen.getByRole("button", { name: /Milk/ });
  fireEvent.click(item);
  await screen.findByRole("alert");
  assert.match(screen.getByRole("alert").textContent, /Sign in again/);
  assert.equal(item.querySelector("svg"), null);
  assert.equal(item.querySelector("p").className.includes("line-through"), false);
});
