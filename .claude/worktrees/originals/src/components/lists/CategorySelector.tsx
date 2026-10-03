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
        <label className="block text-sm font-medium text-gray-700">
          New Category
        </label>
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Category name"
          className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancelCreate}
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateCategory}
            className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
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
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        Category
      </label>
      <select
        id="category-select"
        value={value ?? ""}
        onChange={handleSelectChange}
        disabled={disabled}
        className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
