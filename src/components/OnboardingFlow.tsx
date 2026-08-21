/**
 * Guided onboarding flow for new users.
 * 4 steps: Welcome -> Create list -> Add items -> Share
 * Goal: get users to their aha moment (shared list) within 60 seconds.
 */

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { createListAsset } from "../lib/originals";
import { listCreationErrorMessage } from "../lib/planLimit";
import { buildListResourceDid, buildListResourceUrl } from "../lib/webvh";
import { trackInviteSent } from "../lib/analytics";

const ONBOARDING_KEY = "poo_onboarding_v1";
const DEMO_CREATED_KEY = "boop:onboarding_demo_created";

export function markOnboardingDone() {
  localStorage.setItem(ONBOARDING_KEY, "done");
}

export function isOnboardingDone(): boolean {
  // Old 4-step flow is done, OR new 2-step flow has taken over
  return (
    localStorage.getItem(ONBOARDING_KEY) === "done" ||
    !!localStorage.getItem(DEMO_CREATED_KEY)
  );
}

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step = "welcome" | "create-list" | "add-items" | "share";

const STEPS: Step[] = ["welcome", "create-list", "add-items", "share"];

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { did, legacyDid } = useCurrentUser();
  const navigate = useNavigate();
  const { haptic } = useSettings();

  const createList = useMutation(api.lists.createList);
  const addItem = useMutation(api.items.addItem);
  const publishList = useMutation(api.publication.publishList);

  const [step, setStep] = useState<Step>("welcome");
  const [listId, setListId] = useState<Id<"lists"> | null>(null);
  const [listName, setListName] = useState("");
  const [listNameInput, setListNameInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Add items step
  const [itemInput, setItemInput] = useState("");
  const [addedItems, setAddedItems] = useState<string[]>([]);
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Share step
  const [isPublishing, setIsPublishing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);

  const handleSkip = () => {
    markOnboardingDone();
    haptic("light");
    onComplete();
  };

  const handleFinish = () => {
    markOnboardingDone();
    haptic("success");
    if (listId) {
      navigate(`/list/${listId}`);
    }
    onComplete();
  };

  // Step 1: Create list
  const handleCreateList = async (e: FormEvent) => {
    e.preventDefault();
    const name = listNameInput.trim();
    if (!name || !did) return;

    setIsCreating(true);
    setCreateError(null);
    haptic("medium");

    try {
      const listAsset = await createListAsset(name, did);
      const id = await createList({
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
        name,
        ownerDid: did,
        createdAt: Date.now(),
      });
      setListId(id);
      setListName(name);
      haptic("success");
      setStep("add-items");
    } catch (err) {
      setCreateError(listCreationErrorMessage(err, "Couldn't create list. Try again."));
      haptic("error");
    } finally {
      setIsCreating(false);
    }
  };

  // Step 2: Add item
  const handleAddItem = async () => {
    const name = itemInput.trim();
    if (!name || !listId || !did) return;

    setIsAddingItem(true);
    haptic("light");

    try {
      await addItem({
        listId,
        name,
        createdByDid: did,
        legacyDid: legacyDid ?? undefined,
        createdAt: Date.now(),
      });
      setAddedItems((prev) => [...prev, name]);
      setItemInput("");
    } catch {
      // silently ignore — item add failing shouldn't block onboarding
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleItemKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  };

  // Step 3: Publish to share
  const handlePublish = async () => {
    if (!did || !listId) return;

    setIsPublishing(true);
    setPublishError(null);
    haptic("medium");

    try {
      const webvhDid = buildListResourceDid(did, listId);
      await publishList({ listId, webvhDid, publisherDid: did });
      const url = buildListResourceUrl(did, listId);
      setShareUrl(url);
      haptic("success");
    } catch (err) {
      setPublishError("Couldn't share list. You can share it later.");
      haptic("error");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      haptic("success");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-amber-50 safe-area-inset-top safe-area-inset-bottom">
      {/* Top bar: progress + skip */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? "w-6 h-2 bg-amber-600"
                  : i < stepIndex
                  ? "w-2 h-2 bg-amber-400"
                  : "w-2 h-2 bg-amber-200"
              }`}
            />
          ))}
        </div>

        <button
          onClick={handleSkip}
          className="text-sm font-medium text-amber-700/70 hover:text-amber-700 transition-colors px-2 py-1"
        >
          Skip
        </button>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("create-list")} />
        )}

        {step === "create-list" && (
          <CreateListStep
            value={listNameInput}
            onChange={setListNameInput}
            onSubmit={handleCreateList}
            isCreating={isCreating}
            error={createError}
          />
        )}

        {step === "add-items" && (
          <AddItemsStep
            listName={listName}
            itemInput={itemInput}
            addedItems={addedItems}
            isAddingItem={isAddingItem}
            onItemInputChange={setItemInput}
            onAddItem={handleAddItem}
            onItemKeyDown={handleItemKeyDown}
            onNext={() => setStep("share")}
          />
        )}

        {step === "share" && (
          <ShareStep
            listName={listName}
            shareUrl={shareUrl}
            isPublishing={isPublishing}
            isCopied={isCopied}
            error={publishError}
            onPublish={handlePublish}
            onCopy={handleCopyLink}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

// --- Step components ---

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center max-w-sm w-full">
      <div className="mx-auto mb-8 flex items-center justify-center" style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--boop-accent-soft)' }}>
        <div
          className="rounded-full animate-bounce-slow"
          style={{ width: 44, height: 44, background: 'var(--boop-accent)' }}
          aria-hidden="true"
        />
      </div>
      <h1
        className="text-stone-900 dark:text-stone-50 mb-3"
        style={{
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 32,
          letterSpacing: -1,
          lineHeight: 1.1,
        }}
      >
        Welcome to boop.
      </h1>
      <p className="text-stone-600 dark:text-stone-300 text-base mb-2 leading-relaxed">
        A calm place for the things you need to do.
      </p>
      <p className="text-stone-500 dark:text-stone-400 text-sm mb-10 leading-relaxed">
        Let's get you set up in under 60 seconds. We'll create your first
        list and show you how to share it with someone.
      </p>
      <button
        onClick={onNext}
        className="w-full py-4 bg-amber-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-amber-500/30 hover:bg-amber-500 active:bg-amber-700 transition-all"
      >
        Let's go 🚀
      </button>
    </div>
  );
}

function CreateListStep({
  value,
  onChange,
  onSubmit,
  isCreating,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  isCreating: boolean;
  error: string | null;
}) {
  return (
    <div className="text-center max-w-sm w-full">
      <div className="text-6xl mb-5">✨</div>
      <h2 className="text-2xl font-black text-amber-900 mb-2">
        Name your first list
      </h2>
      <p className="text-amber-800/60 text-sm mb-8">
        Groceries? Weekend plans? Go for it.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Groceries"
          autoFocus
          disabled={isCreating}
          className="w-full px-4 py-4 bg-white/80 text-amber-900 placeholder-amber-400 border-2 border-amber-200 focus:border-amber-500 rounded-2xl text-base focus:outline-none focus:ring-4 focus:ring-amber-500/10 disabled:opacity-50 transition-all"
        />

        {error && (
          <p className="text-red-600 text-sm text-left">{error}</p>
        )}

        <button
          type="submit"
          disabled={!value.trim() || isCreating}
          className="w-full py-4 bg-amber-600 text-white rounded-2xl font-bold text-base shadow-lg shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-500 transition-all"
        >
          {isCreating ? "Creating..." : "Create List ✨"}
        </button>
      </form>
    </div>
  );
}

function AddItemsStep({
  listName,
  itemInput,
  addedItems,
  isAddingItem,
  onItemInputChange,
  onAddItem,
  onItemKeyDown,
  onNext,
}: {
  listName: string;
  itemInput: string;
  addedItems: string[];
  isAddingItem: boolean;
  onItemInputChange: (v: string) => void;
  onAddItem: () => void;
  onItemKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onNext: () => void;
}) {
  return (
    <div className="max-w-sm w-full">
      <div className="text-center mb-6">
        <div className="text-5xl mb-4">📝</div>
        <h2 className="text-2xl font-black text-amber-900 mb-2">
          Add a few items
        </h2>
        <p className="text-amber-800/60 text-sm">
          to <span className="font-semibold">{listName}</span>
        </p>
      </div>

      {/* Added items */}
      {addedItems.length > 0 && (
        <div className="mb-4 space-y-2">
          {addedItems.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 bg-white/70 rounded-xl border border-amber-100"
            >
              <div className="w-5 h-5 rounded-full border-2 border-amber-300 flex-shrink-0" />
              <span className="text-amber-900 text-sm font-medium">{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={itemInput}
          onChange={(e) => onItemInputChange(e.target.value)}
          onKeyDown={onItemKeyDown}
          placeholder="Add an item..."
          autoFocus
          disabled={isAddingItem}
          className="flex-1 px-4 py-3 bg-white/80 text-amber-900 placeholder-amber-400 border-2 border-amber-200 focus:border-amber-500 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-amber-500/10 disabled:opacity-50 transition-all"
        />
        <button
          onClick={onAddItem}
          disabled={!itemInput.trim() || isAddingItem}
          className="px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>

      <button
        onClick={onNext}
        className="w-full py-4 bg-amber-600 text-white rounded-2xl font-bold text-base shadow-lg shadow-amber-500/25 hover:bg-amber-500 transition-all"
      >
        {addedItems.length === 0 ? "Skip this step →" : "Next →"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InviteNudge — step 2 of the 2-step onboarding
// Shown after the user creates their first real list.
// ---------------------------------------------------------------------------

const INVITE_NUDGE_DONE_KEY = "boop:onboarding_invite_nudge_done";

export function isInviteNudgeDone(): boolean {
  return localStorage.getItem(INVITE_NUDGE_DONE_KEY) === "done";
}

export function markInviteNudgeDone() {
  localStorage.setItem(INVITE_NUDGE_DONE_KEY, "done");
}

export function InviteNudge({
  listId,
  listName,
  onDismiss,
}: {
  listId: Id<"lists">;
  listName: string;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const { haptic } = useSettings();

  const handleInvite = () => {
    trackInviteSent("copy");
    haptic("medium");
    onDismiss();
    navigate(`/list/${listId}`, { state: { openShare: true } });
  };

  const handleDismiss = () => {
    haptic("light");
    onDismiss();
  };

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-[150] p-4 safe-area-inset-bottom animate-slide-up">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-800 p-5">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none mt-0.5">🤝</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1">
              Invite someone to collaborate
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Share{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                "{listName}"
              </span>{" "}
              with a friend or teammate. Real-time sync, no account needed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleInvite}
                className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl font-semibold text-sm shadow-lg shadow-amber-500/25 hover:bg-amber-400 transition-all"
              >
                Invite someone →
              </button>
              <button
                onClick={handleDismiss}
                className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm font-medium transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------

function ShareStep({
  listName,
  shareUrl,
  isPublishing,
  isCopied,
  error,
  onPublish,
  onCopy,
  onFinish,
}: {
  listName: string;
  shareUrl: string | null;
  isPublishing: boolean;
  isCopied: boolean;
  error: string | null;
  onPublish: () => void;
  onCopy: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="max-w-sm w-full">
      <div className="text-center mb-6">
        {shareUrl ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-black text-amber-900 mb-2">
              You're all set!
            </h2>
            <p className="text-amber-800/60 text-sm">
              Share <span className="font-semibold">{listName}</span> with
              anyone using this link.
            </p>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">🤝</div>
            <h2 className="text-2xl font-black text-amber-900 mb-2">
              Share your list
            </h2>
            <p className="text-amber-800/60 text-sm">
              Invite someone to collaborate on{" "}
              <span className="font-semibold">{listName}</span> in real time.
            </p>
          </>
        )}
      </div>

      {shareUrl ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              aria-label="Invite link"
              className="flex-1 px-4 py-3 bg-white/80 text-amber-900 border-2 border-amber-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={onCopy}
              aria-label={isCopied ? "Link copied" : "Copy invite link"}
              className={`px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
                isCopied
                  ? "bg-green-500 text-white"
                  : "bg-amber-500 hover:bg-amber-400 text-white"
              }`}
            >
              {isCopied ? "Copied!" : "Copy"}
            </button>
          </div>

          <button
            onClick={onFinish}
            className="w-full py-4 bg-amber-600 text-white rounded-2xl font-bold text-base shadow-lg shadow-amber-500/25 hover:bg-amber-500 transition-all"
          >
            Open my list →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-white/60 rounded-2xl border border-amber-100">
            <ul className="space-y-2 text-sm text-amber-800/80">
              <li className="flex items-center gap-2">
                <span className="text-amber-500">✓</span>
                Anyone with the link can view &amp; edit
              </li>
              <li className="flex items-center gap-2">
                <span className="text-amber-500">✓</span>
                Real-time sync — changes appear instantly
              </li>
              <li className="flex items-center gap-2">
                <span className="text-amber-500">✓</span>
                Stop sharing at any time
              </li>
            </ul>
          </div>

          {error && (
            <p className="text-amber-700 text-sm text-center">{error}</p>
          )}

          <button
            onClick={onPublish}
            disabled={isPublishing}
            className="w-full py-4 bg-amber-600 text-white rounded-2xl font-bold text-base shadow-lg shadow-amber-500/25 disabled:opacity-50 hover:bg-amber-500 transition-all"
          >
            {isPublishing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Sharing...
              </span>
            ) : (
              "Share this list 🔗"
            )}
          </button>

          <button
            onClick={onFinish}
            className="w-full py-3 text-amber-700/60 font-medium text-sm hover:text-amber-700 transition-colors"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}
