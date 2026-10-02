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

test('A -> B -> A remains dirty until the latest revision is acknowledged', async () => {
  const requests = [];
  const persist = (text, base) => new Promise(resolve => requests.push({text, base, resolve}));
  const editor = renderHook(({saved}) => useAutosaveDraft({saved, canEdit:true, persist, draftKey:'owner:note:aba-fixed'}), {initialProps:{saved:'initial'}});
  try {
    await act(async () => editor.result.current.onChange('A'));
    await act(async () => { void editor.result.current.retry(); });
    await act(async () => editor.result.current.onChange('B'));
    await act(async () => { void editor.result.current.retry(); });
    await act(async () => editor.result.current.onChange('A'));
    assert.equal(requests.length, 1, 'writes must be serialized');
    await act(async () => { editor.rerender({saved:'A'}); requests[0].resolve(); });
    assert.equal(editor.result.current.dirty, true);
    assert.deepEqual(requests.map(r=>[r.text,r.base]), [['A','initial'],['A','A']]);
    await act(async () => requests[1].resolve());
    assert.equal(editor.result.current.value, 'A');
    assert.equal(editor.result.current.dirty, false);
    assert.equal(localStorage.getItem('boop-note-draft:owner:note:aba-fixed'), null);
  } finally { editor.unmount(); }
});

test('recovered stale and legacy drafts require explicit conflict resolution', async () => {
  for (const base of ['old server', undefined]) {
    const key = `owner:note:conflict-${base}`;
    localStorage.setItem(`boop-note-draft:${key}`, JSON.stringify({text:'local work',base,revision:'r1'}));
    const writes = [];
    const persist = async (text, expected) => { writes.push([text, expected]); };
    const editor = renderHook(({saved}) => useAutosaveDraft({saved, canEdit:true, persist, draftKey:key}),{initialProps:{saved:'new remote work'}});
    assert.equal(editor.result.current.status, 'conflict');
    await act(async () => { await editor.result.current.retry(); });
    await act(async () => await new Promise(r=>setTimeout(r,650)));
    assert.deepEqual(writes, []);
    await act(async () => editor.result.current.onChange('revised local work'));
    assert.equal(editor.result.current.status, 'conflict');
    await act(async () => { editor.result.current.saveDraft(); editor.rerender({saved:'revised local work'}); });
    assert.deepEqual(writes, [['revised local work','new remote work']]);
    assert.equal(editor.result.current.status, 'saved');
    editor.unmount();
  }
});

test('a server conflict keeps the durable draft, and using server discards without a write', async () => {
  let writes = 0;
  const key = 'owner:note:atomic-conflict';
  const editor = renderHook(() => useAutosaveDraft({saved:'base',canEdit:true,draftKey:key,
    persist:async () => { writes++; throw Object.assign(Error('Server Error'), {data:{code:'NOTE_CONFLICT'}}); }}));
  await act(async () => editor.result.current.onChange('local'));
  await act(async () => await editor.result.current.retry());
  assert.equal(editor.result.current.status, 'conflict');
  assert.equal(durableDrafts(key)[0].text, 'local');
  await act(async () => editor.result.current.useServer());
  assert.equal(editor.result.current.value, 'base');
  assert.equal(localStorage.getItem(`boop-note-draft:${key}`), null);
  editor.unmount();
  assert.equal(writes, 1);
});


function durableDrafts(key) {
  const prefix = `boop-note-draft:${key}`;
  return Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
    .filter(k=>k===prefix || k.startsWith(prefix+':session:'))
    .map(k=>JSON.parse(localStorage.getItem(k)));
}

test('two editors preserve the losing draft after the other editor saves', async () => {
  let server='old';
  const persist=async(text,base)=>{
    if(base!==server) throw Object.assign(Error('Server Error'),{data:{code:'NOTE_CONFLICT'}});
    server=text;
  };
  const key='owner:note:two-editors';
  const create=()=>renderHook(({saved})=>useAutosaveDraft({saved,canEdit:true,persist,draftKey:key}),{initialProps:{saved:'old'}});
  const a=create(),b=create();
  await act(async()=>a.result.current.onChange('work A'));
  await act(async()=>b.result.current.onChange('work B'));
  assert.equal(durableDrafts(key).length,2);
  await act(async()=>await b.result.current.retry());
  await act(async()=>await a.result.current.retry());
  assert.equal(a.result.current.status,'conflict');
  assert.equal(durableDrafts(key)[0].text,'work A');
  a.unmount();b.unmount();
  const reopened=renderHook(()=>useAutosaveDraft({saved:server,canEdit:true,persist,draftKey:key}));
  assert.equal(reopened.result.current.value,'work A');
  assert.equal(reopened.result.current.status,'conflict');
  reopened.unmount();
});

test('multiple unresolved drafts stay individually recoverable',async()=>{
  const key='owner:note:multiple';
  const persist=async()=>{throw Error('offline');};
  const a=renderHook(()=>useAutosaveDraft({saved:'old',canEdit:true,persist,draftKey:key}));
  const b=renderHook(()=>useAutosaveDraft({saved:'old',canEdit:true,persist,draftKey:key}));
  await act(async()=>a.result.current.onChange('draft A'));
  await act(async()=>b.result.current.onChange('draft B'));
  await act(async()=>{a.unmount();b.unmount();});
  const reopened=renderHook(()=>useAutosaveDraft({saved:'new',canEdit:true,persist,draftKey:key}));
  assert.equal(reopened.result.current.otherDrafts.length,1);
  const other=reopened.result.current.otherDrafts[0];
  await act(async()=>reopened.result.current.useServer());
  await act(async()=>reopened.result.current.recoverDraft(other));
  assert.equal(reopened.result.current.value,other.text);
  assert.equal(reopened.result.current.status,'conflict');
  reopened.unmount();
});
