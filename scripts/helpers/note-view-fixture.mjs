import { build } from 'esbuild';

// Real NoteView, autosave, durable drafts, conflict/recovery UI; only application
// context and server transport are replaced. Also usable in a local preview.
export async function buildNoteViewFixture(outfile, browser = false, item = false) {
  await build({ stdin: { contents: `
    import React, { useState } from 'react';
    import { ${item ? 'NoteEditor' : 'NoteView'} as Editor } from './src/pages/${item ? 'NoteEditor' : 'NoteView'}';
    export * as drafts from './src/lib/noteDrafts';
    export const state = globalThis.__noteViewFixture = {
      did: 'did:editor', legacyDids: {}, identityLoading: false, list: { _id: 'N', ownerDid: 'did:owner', name: 'Fixture note', kind: 'note', createdAt: 1 },
      body: 'Original authorized source', accessCheckedAt: 1, canEdit: true, available: true, deny: false, conflictNext: false, writes: [],
    };
    export function Harness() {
      const [, redraw] = useState(0);
      state.refresh = () => redraw(n => n + 1);
      return <><nav>
        <button onClick={() => {state.conflictNext = true;}}>Remote edit on next save</button>
        <button onClick={() => {state.deny = true;}}>Deny next save</button>
        <button onClick={() => {state.body = 'Remote authorized change'; state.refresh();}}>Remote edit</button>
        <button onClick={() => {state.deny = true; state.available = false; state.refresh();}}>Revoke access</button>
        <button onClick={() => {state.canEdit = false; state.deny = true; state.refresh();}}>Downgrade to viewer</button>
        <button onClick={() => {state.did = state.did === 'did:other' ? 'did:editor' : 'did:other'; state.refresh();}}>Switch account</button>
      </nav><Editor /></>;
    }
    ${browser ? `import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')).render(<Harness />);` : ''}
  `, resolveDir: process.cwd(), loader: 'tsx' }, outfile, bundle: true, jsx: 'automatic',
    platform: browser ? 'browser' : 'node', format: 'esm',
    external: browser ? [] : ['react', 'react/jsx-runtime', 'react-dom/client'],
    plugins: [{ name: 'note-app-context', setup(b) {
      b.onResolve({ filter: /\/useCurrentUser$|\/useSettings$|\/useOffline$|\/useCategories$|\/authenticatedConvex$|\/HeaderActionsMenu$|\/VerificationBadge$|\/(DeleteListDialog|RenameListDialog|ChangeCategoryDialog)$|^react-router-dom$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
        const prelude = 'const state = () => globalThis.__noteViewFixture;';
        let contents;
        if (path.endsWith('/authenticatedConvex')) contents = `
          import { getFunctionName } from 'convex/server';
          export const useQuery = ref => getFunctionName(ref) === 'items:getItemForEditor'
            ? (state().available ? {description: state().body, name: 'Fixture item', canEdit: state().canEdit, accessCheckedAt: state().accessCheckedAt} : null)
            : getFunctionName(ref) === 'lists:getList'
            ? (state().available ? state().list : null)
            : (state().available ? { body: state().body, updatedAt: 1, canEdit: state().canEdit, accessCheckedAt: state().accessCheckedAt } : null);
          export const useMutation = () => async args => {
            const s = state(); s.writes.push(args);
            if (s.conflictNext) { s.conflictNext = false; s.body = 'Remote authorized change'; s.refresh?.(); }
            if (s.deny || !s.canEdit || !s.available) throw { data: { kind: 'auth', code: 'FORBIDDEN', message: 'Resource unavailable' } };
            if ((args.expectedBody ?? args.expectedDescription) !== s.body) throw { data: { code: 'NOTE_CONFLICT' } };
            s.body = args.body ?? args.description; s.refresh?.();
          };`;
        else if (path.endsWith('/useCurrentUser')) contents = 'export const useCurrentUser = () => ({ did: state().did, legacyDid: state().legacyDids[state().did] ?? null, isLoading: state().identityLoading });';
        else if (path.endsWith('/useSettings')) contents = 'export const useSettings = () => ({ haptic: () => {} });';
        else if (path.endsWith('/useOffline')) contents = 'export const useOffline = () => ({ isOnline: true });';
        else if (path.endsWith('/useCategories')) contents = 'export const useCategories = () => ({ categories: [] });';
        else if (path === 'react-router-dom') contents = `import React from 'react'; export const useParams = () => ({id: 'N', itemId: 'I'}); export const useNavigate = () => () => {}; export const Navigate = () => null; export const Link = ({to, children, ...props}) => React.createElement('a', {...props, href: to}, children);`;
        else {
          const name = path.split('/').pop();
          contents = `export const ${name === 'VerificationBadge' ? 'ListVerificationBadge' : name} = () => null;`;
        }
        return { contents: prelude + contents, resolveDir: process.cwd() };
      });
    } }],
  });
}
