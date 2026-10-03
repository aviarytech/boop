/**
 * Dropdown component for sorting lists.
 */

import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../../hooks/useSettings';
import type { SortOption } from '../../lib/storage';

const sortOptions: { value: SortOption; label: string; icon: string }[] = [
  { value: 'newest', label: 'Newest First', icon: '🆕' },
  { value: 'oldest', label: 'Oldest First', icon: '📅' },
  { value: 'name-asc', label: 'A → Z', icon: '🔤' },
  { value: 'name-desc', label: 'Z → A', icon: '🔠' },
];

export function SortDropdown() {
  const { listSort, setListSort, haptic } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const currentOption = sortOptions.find((o) => o.value === listSort) || sortOptions[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          haptic('light');
          setIsOpen(!isOpen);
        }}
        className="flex items-center gap-2 px-4 py-3 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <span className="hidden sm:inline">{currentOption.label}</span>
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-50 animate-dropdown">
          <ul role="listbox" aria-label="Sort options">
            {sortOptions.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => {
                    haptic('light');
                    setListSort(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    listSort === option.value
                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  role="option"
                  aria-selected={listSort === option.value}
                >
                  <span>{option.icon}</span>
                  <span>{option.label}</span>
                  {listSort === option.value && (
                    <svg className="w-4 h-4 ml-auto text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
