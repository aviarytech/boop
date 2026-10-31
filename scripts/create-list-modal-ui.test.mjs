// Render the real CreateListModal and Panel. Only external services are mocked.
// Run with Node 22+ or the repository's Bun test command.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost/' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const { MemoryRouter, useLocation, useNavigate } = await import('react-router-dom');
const fixture = globalThis.__createListModalUi = {};
const root = process.env.CREATE_DIALOG_ROOT ?? '.';

await build({
  entryPoints: [`${root}/src/components/CreateListModal.tsx`, `${root}/src/components/ui/Panel.tsx`],
  outdir: 'tmp/create-dialog-ui', outbase: `${root}/src/components`, outExtension: { '.js': '.mjs' },
  bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom'],
  plugins: [{ name: 'create-list-services', setup(b) {
    const mocks = {
      '/lib/authenticatedConvex': 'export const useMutation=()=>globalThis.__createListModalUi.save; export const useQuery=()=>[];',
      '/_generated/api': 'export const api={lists:{createList:"create",getUserLists:"lists"}};',
      '/hooks/useCurrentUser': 'export const useCurrentUser=()=>({did:globalThis.__createListModalUi.did});',
      '/hooks/useSettings': 'export const useSettings=()=>({haptic:value=>globalThis.__createListModalUi.feedback.push(value)});',
      '/lib/planLimit': 'export const isPlanLimitError=error=>error.message==="plan limit";',
      '/lib/noteBody': 'export const isNote=()=>false;',
      '/lists/CategorySelector': 'export const CategorySelector=()=>null;',
      '/ReferralInvite': 'export const ReferralInviteCurrentUser=()=>null;',
      '/lib/analytics': 'const track=(name)=>(...args)=>globalThis.__createListModalUi.analytics.push([name,...args]); export const trackListCreated=track("created"), trackFirstListCreated=track("first"), trackFeatureGateHit=track("limit"), trackInviteSent=track("invite");',
    };
    b.onResolve({ filter: /.*/ }, args => {
      const key = Object.keys(mocks).find(key => args.path.endsWith(key));
      return key ? { path: key, namespace: 'fixture' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path] }));
  } }],
});
const { CreateListModal } = await import(pathToFileURL(`${process.cwd()}/tmp/create-dialog-ui/CreateListModal.mjs`));
const { Panel } = await import(pathToFileURL(`${process.cwd()}/tmp/create-dialog-ui/ui/Panel.mjs`));

afterEach(() => cleanup());
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount({ navigateOnCreated = false } = {}) {
  const calls = { save: [], created: [], closed: 0 };
  const requests = { save: [] };
  Object.assign(fixture, { did: 'did:owner', feedback: [], analytics: [],
    save: args => { calls.save.push(args); const d = deferred(); requests.save.push(d); return d.promise; },
  });
  const controls = {};
  function Harness() {
    const [open, setOpen] = React.useState(true);
    const [generation, setGeneration] = React.useState(0);
    const [, setRevision] = React.useState(0);
    controls.refresh = () => setRevision(value => value + 1);
    controls.location = useLocation();
    controls.navigate = useNavigate();
    controls.open = () => { setGeneration(value => value + 1); setOpen(true); };
    controls.hide = () => setOpen(false);
    return open ? React.createElement(CreateListModal, { key: generation,
      onClose: () => { calls.closed++; setOpen(false); },
      onListCreated: (...args) => { calls.created.push(args); if (navigateOnCreated) controls.navigate(`/list/${args[0]}`); },
    }) : React.createElement('p', null, 'Dialog closed');
  }
  const view = render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/before', '/lists'], initialIndex: 1 }, React.createElement(Harness))));
  const form = () => document.getElementById('create-list-form');
  const submit = () => fireEvent.submit(form());
  const type = value => fireEvent.change(view.getByRole('textbox', { name: 'List name' }), { target: { value } });
  const close = method => {
    if (method === 'header') fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0]);
    else if (method === 'footer') fireEvent.click(view.getAllByRole('button', { name: /^(Close|Cancel)$/ }).at(-1));
    else if (method === 'backdrop') fireEvent.click(view.getByRole('dialog'));
    else if (method === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (method === 'swipe') {
      const panel = view.getByRole('dialog').firstElementChild;
      fireEvent.touchStart(panel, { touches: [{ clientY: 10 }] });
      fireEvent.touchMove(panel, { touches: [{ clientY: 140 }] });
      fireEvent.touchEnd(panel);
    }
  };
  const finishAnimation = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  const finishSave = async (index = 0, id = 'listA') => act(async () => requests.save[index].resolve(id));
  return { view, calls, requests, controls, submit, type, close, finishAnimation, finishSave };
}

// Creation is one save: the list's Original is minted when its owner opens it.
test('rapid form submissions save once and report a successful creation once', async () => {
  const f = mount(); f.type(' Weekend ');
  act(() => { f.submit(); f.submit(); });
  assert.equal(f.calls.save.length, 1);
  assert.equal(f.calls.save[0].name, 'Weekend');
  assert.equal('assetDid' in f.calls.save[0], false, 'creation mints no asset');
  assert.equal('celEnvelope' in f.calls.save[0], false);
  await f.finishSave();
  assert.deepEqual(f.calls.created, [['listA', 'Weekend']]);
  assert.equal(f.controls.location.pathname, '/lists');
  assert.ok(f.view.getByRole('heading', { name: 'List created!' }));
});

for (const method of ['header', 'footer', 'backdrop', 'escape', 'swipe']) {
  for (const phase of ['save']) {
    for (const outcome of ['success', 'failure', 'plan limit']) {
      test(`${method} dismissal during ${phase} suppresses late ${outcome}`, async () => {
        const f = mount({ navigateOnCreated: true }); f.type('Old list'); f.submit();
        f.close(method);
        // Resolve during Panel's closing animation, before its delayed onClose.
        const feedback = [...fixture.feedback];
        const analytics = [...fixture.analytics];
        await act(async () => {
          const d = f.requests[phase][0];
          if (outcome === 'success') d.resolve('oldList');
          else d.reject(new Error(outcome));
        });
        assert.deepEqual(f.calls.created, []);
        assert.deepEqual(fixture.feedback, feedback);
        assert.deepEqual(fixture.analytics, analytics);
        assert.equal(f.calls.save.length, 1);
        assert.equal(f.controls.location.pathname, '/lists');
        assert.equal(f.view.queryByText('Failed to create list. Please try again.'), null);
        assert.equal(f.view.queryByText("You've reached the free plan limit of 5 lists"), null);
        await f.finishAnimation();
        assert.equal(f.calls.closed, 1);
        assert.equal(f.view.queryByRole('dialog'), null);
        await act(async () => f.controls.navigate(-1));
        assert.equal(f.controls.location.pathname, '/before', 'dismissal must not add a history entry');
        await act(async () => f.controls.navigate(1));
        assert.equal(f.controls.location.pathname, '/lists');
      });
    }
  }
}

for (const method of ['header', 'backdrop', 'escape', 'swipe']) {
  test(`${method} after success closes without opening the list`, async () => {
    const f = mount(); f.type('Created'); f.submit(); await f.finishSave();
    f.close(method); await f.finishAnimation();
    assert.equal(f.calls.closed, 1);
    assert.equal(f.controls.location.pathname, '/lists');
  });
}

for (const button of ['Go to list', 'Share with people']) {
  test(`${button} explicitly navigates after success`, async () => {
    const f = mount(); f.type('Created'); f.submit(); await f.finishSave();
    fireEvent.click(f.view.getByRole('button', { name: button }));
    assert.equal(f.controls.location.pathname, '/list/listA');
    assert.deepEqual(f.controls.location.state, button === 'Share with people' ? { openShare: true } : null);
  });
  test(`dismissal blocks ${button} during the closing animation`, async () => {
    const f = mount(); f.type('Created'); f.submit(); await f.finishSave();
    f.close('escape');
    fireEvent.click(f.view.getByRole('button', { name: button }));
    assert.equal(f.controls.location.pathname, '/lists');
    await f.finishAnimation();
  });
}

test('Cancel before submitting simply closes', () => {
  const f = mount(); f.close('footer');
  assert.equal(f.calls.closed, 1);
  assert.equal(f.calls.save.length, 0);
  assert.equal(f.controls.location.pathname, '/lists');
});

test('pending close stays enabled and explains that an in-flight save may finish', () => {
  const f = mount(); f.type('Pending'); f.submit();
  assert.match(f.view.getByRole('status').textContent, /already being saved may still be created/);
  assert.equal(f.view.getAllByRole('button', { name: 'Close' }).at(-1).disabled, false);
  assert.equal(f.view.queryByRole('button', { name: 'Cancel' }), null);
});

for (const phase of ['save']) {
  for (const fails of [false, true]) {
    test(`unmount/remount isolates old ${phase} ${fails ? 'failure' : 'success'} from a new attempt`, async () => {
      const f = mount({ navigateOnCreated: true }); f.type('Old'); f.submit();
      act(() => f.controls.hide());
      act(() => f.controls.navigate('/newer'));
      act(() => f.controls.open());
      f.type('New'); f.submit();
      const feedback = [...fixture.feedback];
      await act(async () => {
        const d = f.requests[phase][0];
        if (fails) d.reject(new Error('late failure'));
        else d.resolve('oldList');
      });
      assert.deepEqual(f.calls.created, []);
      assert.deepEqual(fixture.feedback, feedback);
      assert.equal(f.controls.location.pathname, '/newer');
      assert.equal(f.view.getByRole('textbox', { name: 'List name' }).value, 'New');
      f.submit();
      assert.equal(f.calls.save.length, 2, 'old finally must not unlock the newer submit');
      await f.finishSave(1, 'newList');
      assert.deepEqual(f.calls.created, [['newList', 'New']]);
      assert.equal(f.controls.location.pathname, '/list/newList');
    });
  }
}

test('visible failure permits retry and clears the prior plan-limit message', async () => {
  const f = mount(); f.type('Retry'); f.submit();
  const originalError = console.error; console.error = () => {};
  try { await act(async () => f.requests.save[0].reject(new Error('plan limit'))); }
  finally { console.error = originalError; }
  assert.ok(f.view.getByText("You've reached the free plan limit of 5 lists"));
  f.submit();
  assert.equal(f.view.queryByText("You've reached the free plan limit of 5 lists"), null);
  assert.equal(f.calls.save.length, 2);
  await f.finishSave(1);
  assert.equal(f.calls.created.length, 1);
});

for (const phase of ['save']) {
  for (const fails of [false, true]) {
    test(`in-place identity change isolates old ${phase} ${fails ? 'failure' : 'success'}`, async () => {
      const f = mount({ navigateOnCreated: true }); f.type('Old account'); f.submit();
      fixture.did = 'did:new-owner';
      act(() => f.controls.refresh());
      assert.equal(f.view.getByRole('textbox', { name: 'List name' }).value, '');
      f.type('New account'); f.submit();
      const feedback = [...fixture.feedback];
      await act(async () => {
        const d = f.requests[phase][0];
        if (fails) d.reject(new Error('late old account failure'));
        else d.resolve('oldList');
      });
      assert.deepEqual(f.calls.created, []);
      assert.deepEqual(fixture.feedback, feedback);
      assert.equal(f.controls.location.pathname, '/lists');
      f.submit(); assert.equal(f.calls.save.length, 2);
      await f.finishSave(1, 'newList');
      assert.deepEqual(f.calls.created, [['newList', 'New account']]);
    });
  }
}

test('repeated Panel dismissals trigger one start and one close', async () => {
  let starts = 0, closes = 0;
  const view = render(React.createElement(React.StrictMode, null,
    React.createElement(Panel, { isOpen: true, onCloseStart: () => starts++, onClose: () => closes++ }, 'Panel')));
  act(() => { fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(view.getByRole('dialog')); fireEvent.keyDown(window, { key: 'Escape' }); });
  assert.equal(starts, 1);
  assert.equal(closes, 0);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.equal(closes, 1);
});

test('unmount cancels an old Panel dismissal timer before another dialog opens', async () => {
  const f = mount(); f.close('escape');
  act(() => f.controls.hide()); act(() => f.controls.open());
  f.type('New draft');
  await f.finishAnimation();
  assert.equal(f.calls.closed, 0);
  assert.equal(f.view.getByRole('textbox', { name: 'List name' }).value, 'New draft');
});

test('controlled Panel close clears the overlay and cancels its old timer before reopen', async () => {
  let starts = 0, closes = 0;
  const props = { onCloseStart: () => starts++, onClose: () => closes++ };
  const panel = open => React.createElement(React.StrictMode, null, React.createElement(Panel, { ...props, isOpen: open }, 'Panel'));
  const view = render(panel(true));
  fireEvent.keyDown(window, { key: 'Escape' });
  view.rerender(panel(false));
  assert.equal(view.queryByRole('dialog'), null);
  view.rerender(panel(true));
  assert.ok(view.getByRole('dialog'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.equal(closes, 0, 'canceled animation must not close a reopened panel');
  assert.ok(view.getByRole('dialog'));
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.equal(starts, 2);
  assert.equal(closes, 1);
});
