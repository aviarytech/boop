import { useEffect, useRef, useState } from 'react';
import type { Doc } from '../../convex/_generated/dataModel';
function fields(item: Doc<'items'> & { assigneeDids?: string[] }) {
  return {
    name: item.name, description: item.description ?? '', url: item.url ?? '',
    dueDate: item.dueDate ? new Date(item.dueDate).toISOString().split('T')[0] : '',
    hasRecurrence: !!item.recurrence,
    recurrenceFrequency: item.recurrence?.frequency ?? 'daily',
    recurrenceInterval: item.recurrence?.interval ?? 1,
    recurrenceEndDate: item.recurrence?.endDate ? new Date(item.recurrence.endDate).toISOString().split('T')[0] : '',
    priority: item.priority ?? '', selectedCategory: item.groceryAisle ?? '', assigneeDids: item.assigneeDids ?? (item.assigneeDid ? [item.assigneeDid] : []),
  };
}
export type ItemDetailsDraft = ReturnType<typeof fields>;
/** Remote refreshes update clean forms; they never erase a user's unsaved draft.
 * Keep the source document too so saving a dirty draft checks the version that
 * the user actually edited, rather than silently rebasing onto a newer one. */
export function useItemDetailsDraft(item: Doc<'items'> & { assigneeDids?: string[]; _localKey?: string }) {
  const [draft, setDraft] = useState(() => fields(item));
  const source = useRef(item);
  const dirty = useRef(false);
  useEffect(() => {
    if ((source.current._localKey ?? source.current._id) !== (item._localKey ?? item._id) || !dirty.current) {
      source.current = item;
      dirty.current = false;
      setDraft(fields(item));
    }
  }, [item]);
  const set = <K extends keyof ItemDetailsDraft>(key: K, value: ItemDetailsDraft[K]) => {
    dirty.current = true;
    setDraft(previous => ({ ...previous, [key]: value }));
  };
  const getUnsent = () => {
    if (!dirty.current) return {};
    const original = fields(source.current);
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key as keyof ItemDetailsDraft])));
  };
  const reset = () => { dirty.current = false; source.current = item; setDraft(fields(item)); };
  return { draft, set, source, getUnsent, reset };
}
