/**
 * PROTOTYPE — throwaway route, never ships. Answers #231:
 * "How do notes and lists coexist in one index and one UI?"
 *
 * Three variants of the index page, switchable via `?variant=A|B|C` and the
 * floating bar, on /prototype/notes-index (DEV only). Mock data lives in
 * memory; nothing persists. Click a card to see that variant's list / note
 * header; "New" shows how list-vs-note creation is offered.
 *
 *   ?variant=A  one mixed stream, note cards differ from list cards
 *   ?variant=B  Lists / Notes tabs, notes are their own surface
 *   ?variant=C  Notes is a built-in folder next to the user's categories
 *   &open=<id>  open an entry (see notesIndexMock.ts for ids)
 *   &new=list|note|choose   open the create flow
 *   &tab=notes  (B)   &folder=notes  (C)
 */

import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "../../components/prototype/PrototypeSwitcher";
import { MOCK_ENTRIES, type MockEntry } from "./notesIndexMock";
import { VariantA, VARIANT_A } from "./NotesIndexVariantA";
import { VariantB, VARIANT_B } from "./NotesIndexVariantB";
import { VariantC, VARIANT_C, type Folder } from "./NotesIndexVariantC";
import { MONO } from "./notesIndexShared";

export type CreateKind = "list" | "note" | "choose";

export interface VariantProps {
  entries: MockEntry[];
  openId: string | null;
  setOpen: (id: string | null) => void;
  createKind: CreateKind | null;
  setCreate: (kind: CreateKind | null) => void;
}

const VARIANTS = [VARIANT_A, VARIANT_B, VARIANT_C];
const SUB_PARAMS = ["open", "new", "tab", "folder"];

export function NotesIndexPrototype() {
  const [params, setParams] = useSearchParams();
  const variant = VARIANTS.some((v) => v.key === params.get("variant")) ? params.get("variant")! : "A";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const common: VariantProps = {
    entries: MOCK_ENTRIES,
    openId: params.get("open"),
    setOpen: (id) => setParam("open", id),
    createKind: (params.get("new") as CreateKind | null) ?? null,
    setCreate: (k) => setParam("new", k),
  };

  return (
    <>
      <div
        className="-mx-4 -mt-6 mb-4 px-4 py-1.5 text-[11px] bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 border-b border-amber-300/60 flex items-center gap-3"
        style={{ fontFamily: MONO }}
      >
        <b>PROTOTYPE</b>
        <span>#231 notes + lists in one index · mock data · nothing persists</span>
        <span className="ml-auto hidden sm:inline">← → to switch variants</span>
      </div>

      {variant === "A" && <VariantA {...common} />}
      {variant === "B" && (
        <VariantB {...common} tab={params.get("tab") === "notes" ? "notes" : "lists"} setTab={(t) => setParam("tab", t === "lists" ? null : t)} />
      )}
      {variant === "C" && (
        <VariantC {...common} folder={(params.get("folder") as Folder | null) ?? "all"} setFolder={(f) => setParam("folder", f === "all" ? null : f)} />
      )}

      <PrototypeSwitcher variants={VARIANTS} current={variant} resetParams={SUB_PARAMS} />
    </>
  );
}
