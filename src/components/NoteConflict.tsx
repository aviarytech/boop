export function NoteConflict({ serverBody, onUseServer, onSaveDraft }: {
  serverBody: string;
  onUseServer: () => void;
  onSaveDraft: () => void;
}) {
  return (
    <div role="alert" className="my-4 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-stone-900 dark:bg-stone-900 dark:text-stone-100">
      <p>The server has changed since this draft began. Your draft is kept on this device.</p>
      <details className="my-2">
        <summary>Compare with the server version</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{serverBody || "(Empty note)"}</pre>
      </details>
      <div className="flex flex-wrap gap-4">
        <button type="button" className="underline" onClick={onUseServer}>Discard draft and use server version</button>
        <button type="button" className="underline" onClick={onSaveDraft}>Replace server version with my draft</button>
      </div>
    </div>
  );
}
