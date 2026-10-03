/**
 * Hook for managing user categories.
 *
 * Provides access to the user's categories and mutations for CRUD operations.
 */

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "./useCurrentUser";
import type { Id } from "../../convex/_generated/dataModel";

export function useCategories() {
  const { did } = useCurrentUser();

  const categories = useQuery(
    api.categories.getUserCategories,
    did ? { userDid: did } : "skip"
  );

  const createCategoryMutation = useMutation(api.categories.createCategory);
  const renameCategoryMutation = useMutation(api.categories.renameCategory);
  const deleteCategoryMutation = useMutation(api.categories.deleteCategory);
  const setListCategoryMutation = useMutation(api.categories.setListCategory);

  const createCategory = async (name: string) => {
    if (!did) throw new Error("Not authenticated");
    return createCategoryMutation({
      userDid: did,
      name,
      createdAt: Date.now(),
    });
  };

  const renameCategory = async (categoryId: Id<"categories">, name: string) => {
    if (!did) throw new Error("Not authenticated");
    return renameCategoryMutation({
      categoryId,
      userDid: did,
      name,
    });
  };

  const deleteCategory = async (categoryId: Id<"categories">) => {
    if (!did) throw new Error("Not authenticated");
    return deleteCategoryMutation({
      categoryId,
      userDid: did,
    });
  };

  const setListCategory = async (
    listId: Id<"lists">,
    categoryId: Id<"categories"> | undefined,
    legacyDid?: string
  ) => {
    if (!did) throw new Error("Not authenticated");
    return setListCategoryMutation({
      listId,
      categoryId,
      userDid: did,
      legacyDid,
    });
  };

  return {
    categories: categories ?? [],
    isLoading: categories === undefined,
    createCategory,
    renameCategory,
    deleteCategory,
    setListCategory,
  };
}
