/**
 * Panel for viewing and editing item details.
 * Uses Panel component for slide-up drawer experience.
 * Supports notes, due dates, URLs/links, and recurrence settings.
 */

import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";
import { useOffline } from "../hooks/useOffline";
import { useCategories } from "../hooks/useCategories";
import { queueMutation } from "../lib/offline";
import { AISLES, classifyItem } from "../lib/groceryAisles";
import type { GroceryAisle } from "../lib/groceryAisles";
import { TagSelector } from "./TagSelector";
import { SubItems } from "./SubItems";
import { Attachments } from "./Attachments";
import { Comments } from "./Comments";
import { Panel } from "./ui/Panel";
import { ItemProvenanceInfo } from "./ProvenanceInfo";
import { NaturalDateInput } from "./ui/NaturalDateInput";
import { recordLatencyMs } from "../lib/observability";

interface ItemDetailsModalProps {
  item: Doc<"items">;
  userDid: string;
  legacyDid?: string;
  canEdit: boolean;
  onClose: () => void;
}

type RecurrenceFrequency = "daily" | "weekly" | "monthly";
type Priority = "high" | "medium" | "low" | "";

const PRIORITY_COLORS = {
  high: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700",
  medium: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700",
  low: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border-amber-300 dark:border-amber-700",
};

export function ItemDetailsModal({
  item,
  userDid,
  legacyDid,
  canEdit,
  onClose,
}: ItemDetailsModalProps) {
  const { haptic } = useSettings();
  const { isOnline } = useOffline();
  const updateItem = useMutation(api.items.updateItem);
  const navigate = useNavigate();

  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [dueDate, setDueDate] = useState(
    item.dueDate ? new Date(item.dueDate).toISOString().split("T")[0] : ""
  );
  const [hasRecurrence, setHasRecurrence] = useState(!!item.recurrence);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>(
    item.recurrence?.frequency ?? "daily"
  );
  const [recurrenceInterval, setRecurrenceInterval] = useState(
    item.recurrence?.interval ?? 1
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(
    item.recurrence?.endDate ? new Date(item.recurrence.endDate).toISOString().split("T")[0] : ""
  );
  const [priority, setPriority] = useState<Priority>(item.priority ?? "");
  const [selectedCategory, setSelectedCategory] = useState(item.groceryAisle ?? "");
  const itemAssigneeDid = (item as Doc<"items"> & { assigneeDid?: string }).assigneeDid;
  const [assigneeDid, setAssigneeDid] = useState(itemAssigneeDid ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const startedAt = performance.now();
    requestAnimationFrame(() => {
      recordLatencyMs("activity_panel_open_latency_ms", performance.now() - startedAt, {
        route: window.location.pathname,
        env: import.meta.env.MODE,
      });
    });
  }, [item._id]);

  // Load list to get custom aisles
  const list = useQuery(api.lists.getList, { listId: item.listId });
  const { categories } = useCategories();

  const comments = useQuery(api.comments.getItemComments, {
    itemId: item._id,
    userDid,
    legacyDid,
  });

  const participantDids = useMemo(() => {
    const dids = new Set<string>([userDid, item.createdByDid]);
    if (item.checkedByDid) dids.add(item.checkedByDid);
    if (itemAssigneeDid) dids.add(itemAssigneeDid);
    (comments ?? []).forEach((comment) => dids.add(comment.userDid));
    return Array.from(dids);
  }, [comments, itemAssigneeDid, item.checkedByDid, item.createdByDid, userDid]);

  const participantProfiles = useQuery(
    api.users.getUsersByDids,
    participantDids.length > 0 ? { dids: participantDids } : "skip"
  );

  // Determine if this is a grocery list (for auto-classification hint)
  const isGroceryList = useMemo(() => {
    if (!list || !list.categoryId) return false;
    const cat = categories.find((c: { _id: string; name: string }) => c._id === list.categoryId);
    if (cat) return cat.name.toLowerCase().includes("grocer");
    return list.name?.toLowerCase().includes("grocer") ?? false;
  }, [list, categories]);

  // Available categories: built-in aisles + custom aisles from the list
  const availableCategories: GroceryAisle[] = useMemo(() => {
    const customAisles = (list as any)?.customAisles as GroceryAisle[] | undefined;
    const all = customAisles?.length
      ? [...AISLES, ...customAisles].sort((a, b) => a.order - b.order)
      : [...AISLES];
    return all;
  }, [list]);

  // Auto-classified category (what the system would pick)
  const autoCategory = useMemo(() => {
    return isGroceryList ? classifyItem(item.name) : "other";
  }, [item.name, isGroceryList]);

  // Effective category (user override or auto)
  const effectiveCategory = selectedCategory || autoCategory;

  // Reset state when item changes
  useEffect(() => {
    setName(item.name);
    setDescription(item.description ?? "");
    setUrl(item.url ?? "");
    setDueDate(item.dueDate ? new Date(item.dueDate).toISOString().split("T")[0] : "");
    setHasRecurrence(!!item.recurrence);
    setRecurrenceFrequency(item.recurrence?.frequency ?? "daily");
    setRecurrenceInterval(item.recurrence?.interval ?? 1);
    setRecurrenceEndDate(item.recurrence?.endDate ? new Date(item.recurrence.endDate).toISOString().split("T")[0] : "");
    setPriority(item.priority ?? "");
    setSelectedCategory(item.groceryAisle ?? "");
    setAssigneeDid(itemAssigneeDid ?? "");
  }, [item]);

  const handleSave = async () => {
    if (!canEdit) return;
    
    haptic("medium");
    setIsSaving(true);

    try {
      const payload = {
        itemId: item._id,
        userDid,
        legacyDid,
        name: name !== item.name ? name : undefined,
        description: description || undefined,
        dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
        url: url || undefined,
        recurrence: hasRecurrence
          ? {
              frequency: recurrenceFrequency,
              interval: recurrenceInterval || 1,
              ...(recurrenceEndDate ? { endDate: new Date(recurrenceEndDate).getTime() } : {}),
            }
          : undefined,
        priority: priority || undefined,
        groceryAisle: selectedCategory || undefined,
        assigneeDid: assigneeDid || undefined,
        clearDueDate: !dueDate && !!item.dueDate,
        clearUrl: !url && !!item.url,
        clearRecurrence: !hasRecurrence && !!item.recurrence,
        clearPriority: !priority && !!item.priority,
        clearAssigneeDid: !assigneeDid && !!itemAssigneeDid,
        clearGroceryAisle: !selectedCategory && !!item.groceryAisle,
      };
      
      if (isOnline) {
        await updateItem(payload as any);
      } else {
        await queueMutation({
          type: "updateItem",
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
      
      haptic("success");
      onClose();
    } catch (err) {
      console.error("Failed to update item:", err);
      haptic("error");
    } finally {
      setIsSaving(false);
    }
  };

  const header = (
    <>
      <h2 id="item-details-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {canEdit ? "Edit Item" : "Item Details"}
      </h2>
      <button
        onClick={onClose}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
        aria-label="Close panel"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = canEdit ? (
    <div className="flex justify-end gap-2 px-5 py-4">
      <button
        onClick={onClose}
        className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={isSaving || !name.trim()}
        className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {isSaving ? "Saving..." : "Save"}
      </button>
    </div>
  ) : undefined;

  return (
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="item-details-title"
    >
      {/* Content */}
      <div className="p-5 space-y-4 overflow-x-hidden">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Title
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Description/Notes */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            📝 Notes
          </label>
          {canEdit ? (
            <button
              type="button"
              onClick={() => { haptic("light"); navigate(`/note/${item._id}`); }}
              className="w-full text-left px-3 py-2 min-h-[3.5rem] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {description.trim() ? (
                <div className="prose prose-sm dark:prose-invert max-w-none line-clamp-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
                </div>
              ) : (
                <span className="text-gray-400">Add notes or details…</span>
              )}
            </button>
          ) : description.trim() ? (
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            </div>
          ) : (
            <p className="px-3 py-2 text-sm text-gray-400">No notes</p>
          )}
        </div>

        {/* URL/Link */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            🔗 Link (PR, URL, etc.)
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!canEdit}
            placeholder={canEdit ? "https://..." : "No link"}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            👤 Assignee
          </label>
          <select
            value={assigneeDid}
            onChange={(e) => setAssigneeDid(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {participantDids.map((did) => {
              const label = participantProfiles?.[did]?.displayName ?? `${did.slice(0, 8)}…`;
              return (
                <option key={did} value={did}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>

        {/* Presence */}
        {participantDids.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              🟢 Presence
            </label>
            <div className="flex flex-wrap gap-2">
              {participantDids.map((did) => {
                const recentComment = (comments ?? [])
                  .filter((comment) => comment.userDid === did)
                  .sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt ?? 0;
                const recentActivity = Math.max(
                  did === item.createdByDid ? item.createdAt : 0,
                  did === item.checkedByDid ? item.checkedAt ?? 0 : 0,
                  recentComment
                );
                const minutesAgo = recentActivity ? Math.floor((Date.now() - recentActivity) / 60000) : null;
                const isActive = minutesAgo !== null && minutesAgo <= 10;
                return (
                  <span
                    key={`presence-${did}`}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${
                      isActive
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
                    {participantProfiles?.[did]?.displayName ?? `${did.slice(0, 8)}…`}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Priority */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            🚨 Priority
          </label>
          <div className="flex gap-2">
            {(["", "low", "medium", "high"] as Priority[]).map((p) => (
              <button
                key={p || "none"}
                type="button"
                onClick={() => canEdit && setPriority(p)}
                disabled={!canEdit}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                  priority === p
                    ? p
                      ? PRIORITY_COLORS[p]
                      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-400 dark:border-gray-500"
                    : "bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                } disabled:opacity-50`}
              >
                {p ? p.charAt(0).toUpperCase() + p.slice(1) : "None"}
              </button>
            ))}
          </div>
        </div>

        {/* Category / Aisle */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            🏷️ Category
          </label>
          <div className="flex flex-wrap gap-1.5">
            {/* "Auto" chip - clears override */}
            <button
              type="button"
              onClick={() => canEdit && setSelectedCategory("")}
              disabled={!canEdit}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                !selectedCategory
                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                  : "bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              } disabled:opacity-50`}
            >
              ✨ Auto{isGroceryList && !selectedCategory ? ` (${availableCategories.find(a => a.id === autoCategory)?.name ?? "Other"})` : ""}
            </button>
            {availableCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => canEdit && setSelectedCategory(cat.id)}
                disabled={!canEdit}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  selectedCategory === cat.id
                    ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                    : effectiveCategory === cat.id && !selectedCategory
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-500 border-amber-200 dark:border-amber-800"
                      : "bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                } disabled:opacity-50`}
              >
                {cat.emoji} {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            📅 Due Date
          </label>
          <NaturalDateInput
            value={dueDate}
            onChange={setDueDate}
            disabled={!canEdit}
          />
        </div>

        {/* Recurrence */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            <input
              type="checkbox"
              checked={hasRecurrence}
              onChange={(e) => setHasRecurrence(e.target.checked)}
              disabled={!canEdit}
              className="rounded border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-500"
            />
            🔁 Recurring
          </label>
          {hasRecurrence && (
            <div className="space-y-3 pl-1">
              {/* Frequency + Interval row */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">Every</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                  disabled={!canEdit}
                  className="w-16 px-2 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                />
                <select
                  value={recurrenceFrequency}
                  onChange={(e) => setRecurrenceFrequency(e.target.value as RecurrenceFrequency)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  <option value="daily">{recurrenceInterval === 1 ? "day" : "days"}</option>
                  <option value="weekly">{recurrenceInterval === 1 ? "week" : "weeks"}</option>
                  <option value="monthly">{recurrenceInterval === 1 ? "month" : "months"}</option>
                </select>
              </div>
              {/* End date (optional) */}
              <div>
                <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">
                  End date (optional)
                </label>
                <input
                  type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            🏷️ Tags
          </label>
          <TagSelector
            listId={item.listId}
            itemId={item._id}
            selectedTagIds={item.tags ?? []}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canEdit}
          />
        </div>

        {/* Sub-items */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            📦 Sub-items / Checklist
          </label>
          <SubItems
            parentId={item._id}
            listId={item.listId}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canEdit}
          />
        </div>

        {/* Attachments */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            📷 Attachments
          </label>
          <Attachments
            itemId={item._id}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canEdit}
          />
        </div>

        {/* Activity */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            🕘 Activity
          </label>
          <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2">
            {[
              { type: "created", at: item.createdAt, did: item.createdByDid, text: "Created item" },
              ...(item.checkedAt
                ? [{ type: "checked", at: item.checkedAt, did: item.checkedByDid ?? item.createdByDid, text: item.checked ? "Checked off" : "Updated check status" }]
                : []),
              ...((comments ?? []).map((comment) => ({
                type: "comment",
                at: comment.createdAt,
                did: comment.userDid,
                text: `Commented: ${comment.text.slice(0, 60)}`,
              }))),
            ]
              .sort((a, b) => b.at - a.at)
              .map((entry, index) => (
                <div key={`${entry.type}-${entry.at}-${index}`} className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    {participantProfiles?.[entry.did]?.displayName ?? `${entry.did.slice(0, 8)}…`}
                  </span>{" "}
                  {entry.text}
                  <span className="text-gray-400 dark:text-gray-500"> · {new Date(entry.at).toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Comments */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            💬 Comments
          </label>
          <Comments
            itemId={item._id}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canEdit}
          />
        </div>

        {/* Originals Provenance Info */}
        <div>
          <ItemProvenanceInfo item={item} />
        </div>
      </div>
    </Panel>
  );
}
