/**
 * Home page showing user's lists.
 *
 * Modern minimal design with card layout, FAB, warm cream/amber palette.
 * Displays lists grouped by category with collapsible sections.
 * Includes search, sorting, pull-to-refresh, and improved empty states.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useCategories } from "../hooks/useCategories";
import { useOffline } from "../hooks/useOffline";
import { useSettings } from "../hooks/useSettings";
import { ListCard } from "../components/ListCard";
import { CreateListModal } from "../components/CreateListModal";
import { TemplatePickerModal } from "../components/TemplatePickerModal";
import { CategoryHeader } from "../components/lists/CategoryHeader";
import { CategoryManager } from "../components/lists/CategoryManager";
import { SearchInput } from "../components/ui/SearchInput";
import { SortDropdown } from "../components/ui/SortDropdown";
import { HomePageSkeleton } from "../components/ui/Skeleton";
import { NoListsEmptyState, NoSearchResultsEmptyState } from "../components/ui/EmptyState";
import { cacheAllLists, getAllCachedLists, type OfflineList } from "../lib/offline";
import { useStreaks } from "../hooks/useStreaks";
import { StreakBadge } from "../components/StreakBadge";
import { OnboardingFlow, isOnboardingDone, InviteNudge, isInviteNudgeDone, markInviteNudgeDone } from "../components/OnboardingFlow";
import { createListAsset } from "../lib/originals";
import { trackFirstListCreated } from "../lib/analytics";
import { useBilling } from "../hooks/useBilling";
import { ReferralInviteCurrentUser } from "../components/ReferralInvite";

export function Home() {
  const { did, legacyDid, isLoading: userLoading } = useCurrentUser();
  const { isPro } = useBilling();
  const { streak } = useStreaks(did ?? undefined);
  const { categories, isLoading: categoriesLoading } = useCategories();
  const { isOnline } = useOffline();
  const { listSort, haptic } = useSettings();
  const [searchParams] = useSearchParams();
  
  const createList = useMutation(api.lists.createList);
  const addItem = useMutation(api.items.addItem);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(isOnboardingDone);
  const [cachedLists, setCachedLists] = useState<OfflineList[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // 2-step onboarding state
  const demoCreatingRef = useRef(false);
  const [demoStarted, setDemoStarted] = useState(
    () => !!localStorage.getItem("boop:onboarding_demo_created")
  );
  const [inviteNudge, setInviteNudge] = useState<{ listId: Id<"lists">; listName: string } | null>(null);
  const [inviteNudgeDone, setInviteNudgeDone] = useState(isInviteNudgeDone);

  // Check for action param (e.g., from PWA shortcut)
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setIsTemplatePickerOpen(true);
    }
  }, [searchParams]);

  // Query lists for current DID, including legacyDid for backwards compat
  const serverLists = useQuery(
    api.lists.getUserLists,
    did ? { userDid: did, legacyDid: legacyDid ?? undefined } : "skip"
  );


  // Cache lists when online and data is available
  useEffect(() => {
    if (serverLists && isOnline) {
      const listsToCache = serverLists.map((list) => ({
        _id: list._id,
        assetDid: list.assetDid,
        name: list.name,
        ownerDid: list.ownerDid,
        categoryId: list.categoryId,
        createdAt: list.createdAt,
      }));
      cacheAllLists(listsToCache);
    }
  }, [serverLists, isOnline]);

  // Load cached lists when offline
  useEffect(() => {
    if (!isOnline && !serverLists) {
      getAllCachedLists().then(setCachedLists);
    }
  }, [isOnline, serverLists]);

  // Step 1: auto-create "Getting Started" demo list for new users
  useEffect(() => {
    if (demoStarted || demoCreatingRef.current) return;
    if (!did || serverLists === undefined) return;

    if (serverLists.length > 0) {
      // Existing user — mark done without creating demo
      localStorage.setItem("boop:onboarding_demo_created", "done");
      setDemoStarted(true);
      return;
    }

    // New user with no lists — create demo immediately
    demoCreatingRef.current = true;
    localStorage.setItem("boop:onboarding_demo_created", "pending");
    setDemoStarted(true); // suppress old 4-step OnboardingFlow

    const createDemo = async () => {
      try {
        const listAsset = await createListAsset("Getting Started", did);
        const listId = await createList({
          assetDid: listAsset.assetDid,
          celEnvelope: listAsset.envelope,
          name: "Getting Started",
          ownerDid: did,
          createdAt: Date.now(),
        });
        const demoItems = [
          "Add your first item",
          "Share this list with someone",
          "Check off a task",
        ];
        for (const name of demoItems) {
          await addItem({
            listId,
            name,
            createdByDid: did,
            legacyDid: legacyDid ?? undefined,
            createdAt: Date.now(),
          });
        }
        trackFirstListCreated();
        localStorage.setItem("boop:onboarding_demo_created", "done");
      } catch {
        // If creation fails, clear so it can retry next session
        localStorage.removeItem("boop:onboarding_demo_created");
        setDemoStarted(false);
        demoCreatingRef.current = false;
      }
    };

    createDemo();
  }, [did, legacyDid, serverLists, demoStarted, createList, addItem]);

  // Use server data when available, cache when offline
  const lists = (serverLists ?? (!isOnline ? cachedLists : undefined)) as
    | Doc<"lists">[]
    | undefined;

  const usingCache = !isOnline && !serverLists && cachedLists.length > 0;

  // One query for every card on the page rather than one per card. Skipped
  // until the lists arrive, and while offline, where the ids may be stale.
  const legacyIds = useQuery(
    api.lists.getLegacyListIds,
    lists && !usingCache ? { listIds: lists.map((l) => l._id) } : "skip"
  );
  const legacySet = useMemo(() => new Set(legacyIds ?? []), [legacyIds]);

  // Filter and sort lists
  const processedLists = useMemo(() => {
    if (!lists) return undefined;

    let filtered = lists;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = lists.filter(list => 
        list.name.toLowerCase().includes(query)
      );
    }

    return [...filtered].sort((a, b) => {
      switch (listSort) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'newest':
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [lists, searchQuery, listSort]);

  type GroupedLists = {
    categorized: Map<Id<"categories">, Doc<"lists">[]>;
    uncategorized: Doc<"lists">[];
  };

  // Get bookmarked list IDs for favourites section
  const bookmarkedIds = useQuery(
    api.publication.getUserBookmarkIds,
    did ? { userDid: did } : "skip"
  );
  const bookmarkedIdSet = useMemo(() => new Set(bookmarkedIds ?? []), [bookmarkedIds]);

  const { ownedLists, sharedLists, favouriteLists } = useMemo<{ ownedLists: GroupedLists; sharedLists: GroupedLists; favouriteLists: Doc<"lists">[] }>(() => {
    const isOwnedByUser = (list: Doc<"lists">) => {
      const ownerDid = list.ownerDid;
      return ownerDid === did || ownerDid === legacyDid;
    };

    const emptyGroup: GroupedLists = { categorized: new Map(), uncategorized: [] };
    if (!processedLists) {
      return { ownedLists: emptyGroup, sharedLists: { categorized: new Map(), uncategorized: [] }, favouriteLists: [] };
    }

    const owned: Doc<"lists">[] = [];
    const shared: Doc<"lists">[] = [];
    const favourites: Doc<"lists">[] = [];

    for (const list of processedLists) {
      // Favourites: bookmarked lists (owned or shared)
      if (bookmarkedIdSet.has(list._id)) {
        favourites.push(list);
      }
      if (isOwnedByUser(list)) {
        owned.push(list);
      } else {
        shared.push(list);
      }
    }

    const groupByCategory = (listsToGroup: Doc<"lists">[]): GroupedLists => {
      const categorized = new Map<Id<"categories">, Doc<"lists">[]>();
      const uncategorized: Doc<"lists">[] = [];

      for (const list of listsToGroup) {
        if (list.categoryId) {
          const existing = categorized.get(list.categoryId) ?? [];
          existing.push(list);
          categorized.set(list.categoryId, existing);
        } else {
          uncategorized.push(list);
        }
      }

      return { categorized, uncategorized };
    };

    return {
      ownedLists: groupByCategory(owned),
      sharedLists: groupByCategory(shared),
      favouriteLists: favourites,
    };
  }, [processedLists, did, legacyDid, bookmarkedIdSet]);

  // Flatten all shared lists (don't group by sharer's categories)
  const allSharedLists = useMemo(() => {
    const fromCategorized = Array.from(sharedLists.categorized.values()).flat();
    return [...fromCategorized, ...sharedLists.uncategorized];
  }, [sharedLists]);

  const handleOpenCreate = () => {
    haptic('light');
    setIsTemplatePickerOpen(true);
  };

  const handleCreateBlank = () => {
    setIsTemplatePickerOpen(false);
    setIsCreateModalOpen(true);
  };

  const handleListCreated = (listId: Id<"lists">, listName: string) => {
    if (!inviteNudgeDone) {
      setInviteNudge({ listId, listName });
    }
  };

  const handleDismissInviteNudge = () => {
    markInviteNudgeDone();
    setInviteNudgeDone(true);
    setInviteNudge(null);
  };

  if (!did && !userLoading) {
    return null;
  }

  const isLoading = lists === undefined || categoriesLoading;
  const hasLists = lists && lists.length > 0;
  const hasFilteredResults = processedLists && processedLists.length > 0;
  const totalListCount = lists?.length ?? 0;

  return (
    <div className="min-h-full pb-28">
      {/* Greeting hero with streak + profile avatar inline on the right */}
      <div className="flex items-start justify-between gap-3 pt-2 pb-5">
        <div className="flex-1 min-w-0">
          <h1
            className="text-stone-900 dark:text-stone-50"
            style={{
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 'clamp(30px, 5.5vw, 40px)',
              letterSpacing: -1.2,
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            {hasLists ? <>Your lists —<br /><span className="text-stone-500 dark:text-stone-400" style={{ fontWeight: 600 }}>what's on today?</span></> : <>Welcome in,<br /><span className="text-stone-500 dark:text-stone-400" style={{ fontWeight: 600 }}>let's make your first list.</span></>}
          </h1>
          {hasLists && (
            <div
              className="flex items-center gap-3.5 flex-wrap mt-3 text-[13px] text-stone-500 dark:text-stone-400"
            >
              <span>
                <b className="text-stone-900 dark:text-stone-100">{totalListCount}</b> {totalListCount === 1 ? 'list' : 'lists'}
              </span>
              {allSharedLists.length > 0 && (
                <>
                  <span className="text-stone-300 dark:text-stone-600">·</span>
                  <span>
                    <b className="text-stone-900 dark:text-stone-100">{allSharedLists.length}</b> shared
                  </span>
                </>
              )}
              {favouriteLists.length > 0 && (
                <>
                  <span className="text-stone-300 dark:text-stone-600">·</span>
                  <span>
                    <b className="text-stone-900 dark:text-stone-100">{favouriteLists.length}</b> pinned
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {streak > 0 && <StreakBadge streak={streak} />}
          <Link
            to="/profile"
            onClick={() => haptic('light')}
            aria-label="Profile"
            className="flex items-center justify-center w-[34px] h-[34px] rounded-full text-white font-extrabold text-sm active:scale-95 transition-transform"
            style={{
              background: 'var(--boop-accent)',
              fontFamily: 'Nunito, system-ui, sans-serif',
              letterSpacing: -0.3,
            }}
          >
            {(did ?? 'r').slice(-1).toUpperCase() || 'R'}
          </Link>
        </div>
      </div>

      {/* Search + New button — inline pill row */}
      {hasLists && (
        <div className="flex gap-2.5 mb-3 items-center">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              className="w-full"
            />
          </div>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold text-white active:scale-95 transition-transform whitespace-nowrap"
            style={{
              background: 'var(--boop-accent)',
              boxShadow: '0 4px 14px rgba(107,60,255,0.3)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>New</span>
          </button>
        </div>
      )}

      {/* Secondary row — Focus, Categories, Sort */}
      {hasLists && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Link
            to="/priority"
            onClick={() => haptic('light')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800/60 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors"
          >
            <span>🎯</span>
            <span>Focus</span>
          </Link>
          <button
            onClick={() => {
              haptic('light');
              setIsCategoryManagerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800/60 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors"
          >
            <span>📁</span>
            <span>Categories</span>
          </button>
          <div className="ml-auto">
            <SortDropdown />
          </div>
        </div>
      )}

      {/* Offline indicator */}
      {usingCache && (
        <div className="mb-5 px-4 py-3 bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 rounded-2xl text-amber-700 dark:text-amber-400 text-sm flex items-center gap-2.5 animate-slide-up">
          <span>📡</span>
          <span>Offline — showing cached lists</span>
        </div>
      )}

      {/* Referral CTA — shown to free users who have lists */}
      {!isLoading && hasLists && !isPro && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 rounded-2xl animate-slide-up">
          <ReferralInviteCurrentUser compact />
        </div>
      )}

      {/* Loading */}
      {isLoading && <HomePageSkeleton />}

      {/* Empty state - no lists */}
      {!isLoading && !hasLists && (
        <div className="animate-slide-up">
          <NoListsEmptyState onCreateList={handleOpenCreate} />
        </div>
      )}

      {/* Empty state - no search results */}
      {!isLoading && hasLists && !hasFilteredResults && searchQuery && (
        <div className="animate-slide-up">
          <NoSearchResultsEmptyState query={searchQuery} />
        </div>
      )}

      {/* Lists */}
      {!isLoading && hasFilteredResults && did && (
        <div className="space-y-8 animate-slide-up">
          {/* Favourites */}
          {favouriteLists.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">⭐</span>
                <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200">
                  Favourites
                </h2>
                <span className="text-sm font-normal text-stone-500 dark:text-stone-400">({favouriteLists.length})</span>
              </div>
              <div className="space-y-3">
                {favouriteLists.map((list, index) => (
                  <div key={`fav-${list._id}`} className="animate-slide-up" style={{ animationDelay: `${index * 40}ms` }}>
                    <ListCard list={list} currentUserDid={did} showOwner={list.ownerDid !== did && list.ownerDid !== legacyDid} isLegacy={legacySet.has(list._id)} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Owned lists */}
          {(ownedLists.uncategorized.length > 0 || Array.from(ownedLists.categorized.values()).some(l => l.length > 0)) && (
            <section>
              {categories.map((category) => {
                const categoryLists = ownedLists.categorized.get(category._id);
                if (!categoryLists || categoryLists.length === 0) return null;

                return (
                  <CategoryHeader
                    key={category._id}
                    name={category.name}
                    listCount={categoryLists.length}
                  >
                    <div className="space-y-3">
                      {categoryLists.map((list, index) => (
                        <div key={list._id} className="animate-slide-up" style={{ animationDelay: `${index * 40}ms` }}>
                          <ListCard list={list} currentUserDid={did} isLegacy={legacySet.has(list._id)} />
                        </div>
                      ))}
                    </div>
                  </CategoryHeader>
                );
              })}

              {ownedLists.uncategorized.length > 0 && (
                <CategoryHeader
                  name="Uncategorized"
                  listCount={ownedLists.uncategorized.length}
                >
                  <div className="space-y-3">
                    {ownedLists.uncategorized.map((list, index) => (
                      <div key={list._id} className="animate-slide-up" style={{ animationDelay: `${index * 40}ms` }}>
                        <ListCard list={list} currentUserDid={did} isLegacy={legacySet.has(list._id)} />
                      </div>
                    ))}
                  </div>
                </CategoryHeader>
              )}
            </section>
          )}

          {/* Shared lists - shown flat (categories belong to the sharer, not the viewer) */}
          {allSharedLists.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🤝</span>
                <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200">
                  Shared with me
                </h2>
                <span className="text-sm font-normal text-stone-500 dark:text-stone-400">({allSharedLists.length})</span>
              </div>

              <div className="space-y-3">
                {allSharedLists.map((list, index) => (
                  <div key={list._id} className="animate-slide-up" style={{ animationDelay: `${index * 40}ms` }}>
                    <ListCard list={list} currentUserDid={did} showOwner />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={handleOpenCreate}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white rounded-2xl shadow-lg shadow-amber-500/30 hover:shadow-xl hover:shadow-amber-500/40 focus:outline-none focus:ring-4 focus:ring-amber-400/30 transition-all active:scale-90 flex items-center justify-center group"
        aria-label="Create new list"
      >
        <svg 
          className="w-6 h-6 transition-transform duration-200 group-hover:rotate-90" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Modals */}
      {isTemplatePickerOpen && (
        <TemplatePickerModal 
          onClose={() => setIsTemplatePickerOpen(false)}
          onCreateBlank={handleCreateBlank}
        />
      )}

      {isCreateModalOpen && (
        <CreateListModal
          onClose={() => setIsCreateModalOpen(false)}
          onListCreated={handleListCreated}
        />
      )}

      {isCategoryManagerOpen && (
        <CategoryManager onClose={() => setIsCategoryManagerOpen(false)} />
      )}

      {/* Legacy 4-step onboarding — suppressed when new 2-step onboarding is active */}
      {!onboardingDismissed && !isLoading && !hasLists && !demoStarted && (
        <OnboardingFlow onComplete={() => setOnboardingDismissed(true)} />
      )}

      {/* Step 2: invite nudge — shown after user creates their first real list */}
      {inviteNudge && (
        <InviteNudge
          listId={inviteNudge.listId}
          listName={inviteNudge.listName}
          onDismiss={handleDismissInviteNudge}
        />
      )}
    </div>
  );
}
