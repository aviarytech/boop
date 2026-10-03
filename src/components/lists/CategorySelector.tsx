/**
 * Dropdown selector for choosing a category.
 *
 * Includes option to create a new category inline.
 * Used in CreateListModal and list settings.
 */

import { useState, type ChangeEvent } from "react";
import { useCategories } from "../../hooks/useCategories";
import type { Id } from "../../../convex/_generated/dataModel";

interface CategorySelectorProps {
  value: Id<"categories"> | undefined;
  onChange: (categoryId: Id<"categories"> | undefined) => void;
  disabled?: boolean;
}

export function CategorySelector({
  value,
  onChange,
  disabled = false,
}: CategorySelectorProps) {
  const { categories, createCategory } = useCategories();
  const [isCreating, setIsCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    if (selectedValue === "__new__") {
      setIsCreating(true);
      setNewCategoryName("");
      setError(null);
    } else if (selectedValue === "") {
      onChange(undefined);
    } else {
      onChange(selectedValue as Id<"categories">);
    }
  };

  const handleCreateCategory = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      setError("Please enter a category name");
      return;
    }

    try {
      const newCategoryId = await createCategory(trimmedName);
      onChange(newCategoryId);
      setIsCreating(false);
      setNewCategoryName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewCategoryName("");
    setError(null);
  };

  if (isCreating) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          New Category
        </label>
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Category name"
          className="w-full px-3 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreateCategory();
            } else if (e.key === "Escape") {
              handleCancelCreate();
            }
          }}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancelCreate}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateCategory}
            className="px-3 py-1.5 text-sm text-white bg-amber-500 rounded-md hover:bg-amber-600"
          >
            Create
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor="category-select"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
      >
        Category
      </label>
      <select
        id="category-select"
        value={value ?? ""}
        onChange={handleSelectChange}
        disabled={disabled}
        className="w-full px-3 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category._id} value={category._id}>
            {category.name}
          </option>
        ))}
        <option value="__new__">+ Create new category</option>
      </select>
    </div>
  );
}
