import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
const { renderHook, act } = await import('@testing-library/react');
await build({ entryPoints: ['src/hooks/useAutosaveDraft.ts'], outfile: 'tmp/autosave-draft-test.mjs', bundle: true, platform: 'node', format: 'esm', external: ['react'] });
const { useAutosaveDraft } = await import(pathToFileURL(`${process.cwd()}/tmp/autosave-draft-test.mjs`));

test('failed autosave keeps the draft, warns on close, and retries the latest text', async () => {
  let reject = true;
  const writes = [];
  const persist = async text => {
    writes.push(text);
    if (reject) throw new Error('Save failed');
  };
  const { result, rerender, unmount } = renderHook(
    ({ saved, canEdit }) => useAutosaveDraft({ saved, canEdit, persist }),
    { initialProps: { saved: 'old', canEdit: true } },
  );
  try {
    await act(async () => result.current.onChange('draft'));
    await act(async () => await new Promise(resolve => setTimeout(resolve, 650)));
    assert.equal(result.current.status, 'error');
    assert.equal(result.current.value, 'draft');
    assert.equal(result.current.dirty, true);
    const closing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(closing);
    assert.equal(closing.defaultPrevented, true);
    await act(async () => result.current.onChange('latest draft'));
    reject = false;
    // Model the server subscription updating with the acknowledged value.
    await act(async () => {
      result.current.retry();
      rerender({ saved: 'latest draft', canEdit: true });
    });
    assert.deepEqual(writes, ['draft', 'latest draft']);
    assert.equal(result.current.status, 'saved');
    assert.equal(result.current.value, 'latest draft');
    assert.equal(result.current.dirty, false);
    const cleanClose = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanClose);
    assert.equal(cleanClose.defaultPrevented, false);
  } finally { unmount(); }
});

test('retry cannot write after edit permission is removed', async () => {
  const writes = [];
  const persist = async text => { writes.push(text); };
  const { result, rerender, unmount } = renderHook(
    ({ canEdit }) => useAutosaveDraft({ saved: 'old', canEdit, persist }),
    { initialProps: { canEdit: true } },
  );
  try {
    await act(async () => result.current.onChange('draft'));
    rerender({ canEdit: false });
    await act(async () => result.current.retry());
    assert.deepEqual(writes, []);
  } finally { unmount(); }
});

test('failed unmount save preserves a draft across remount, scoped to its account', async () => {
  const key = 'owner:note:navigation';
  const persist = async () => { throw new Error('Rejected'); };
  const first = renderHook(() => useAutosaveDraft({ saved: 'old', canEdit: true, persist, draftKey: key }));
  await act(async () => first.result.current.onChange('do not lose me'));
  await act(async () => first.unmount());
  const reopened = renderHook(() => useAutosaveDraft({ saved: 'old', canEdit: true, persist, draftKey: key }));
  const other = renderHook(() => useAutosaveDraft({ saved: 'other', canEdit: true, persist, draftKey: 'other:note:navigation' }));
  assert.equal(reopened.result.current.value, 'do not lose me');
  assert.equal(other.result.current.value, 'other');
  await act(async () => { reopened.unmount(); other.unmount(); });
});

test('late acknowledgement from a previous editor cannot erase newer durable edits', async () => {
  const pending = [];
  const persist = () => new Promise(resolve => pending.push(resolve));
  const props = { saved: 'old', canEdit: true, persist, draftKey: 'owner:note:late' };
  const first = renderHook(() => useAutosaveDraft(props));
  await act(async () => first.result.current.onChange('first'));
  await act(async () => first.unmount());
  const second = renderHook(() => useAutosaveDraft(props));
  await act(async () => second.result.current.onChange('second'));
  await act(async () => pending.shift()());
  await act(async () => second.unmount());
  const third = renderHook(() => useAutosaveDraft(props));
  assert.equal(third.result.current.value, 'second');
  await act(async () => third.unmount());
  await act(async () => pending.forEach(resolve => resolve()));
});
