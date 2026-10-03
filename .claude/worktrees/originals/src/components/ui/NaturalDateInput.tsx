/**
 * Natural language date input component.
 * Allows users to type dates like "tomorrow at 3pm", "next Friday", etc.
 * Uses a lightweight built-in parser (no external dependencies).
 */

import { useState, useEffect } from "react";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseNaturalDate(text: string, ref: Date = new Date()): Date | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const today = new Date(ref);
  today.setHours(0, 0, 0, 0);

  if (t === "today" || t === "now") return today;

  if (t === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  if (t === "yesterday") {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // "next <day>" or just "<day>"
  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    if (t === day || t === `next ${day}` || t === day.slice(0, 3) || t === `next ${day.slice(0, 3)}`) {
      const d = new Date(today);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  // "in N days/weeks"
  const inMatch = t.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const d = new Date(today);
    d.setDate(d.getDate() + (inMatch[2].startsWith("week") ? n * 7 : n));
    return d;
  }

  // Try native Date.parse as fallback (handles "Feb 21", "2026-03-01", etc.)
  const parsed = new Date(t);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

interface NaturalDateInputProps {
  value: string; // YYYY-MM-DD format
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function NaturalDateInput({
  value,
  onChange,
  disabled = false,
  placeholder = "e.g., tomorrow at 3pm, next Friday, today...",
}: NaturalDateInputProps) {
  const [inputText, setInputText] = useState("");
  const [parsedDate, setParsedDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Initialize input text from value
  useEffect(() => {
    if (value && !inputText) {
      // If we have a value but no input text, format it nicely
      const date = new Date(value);
      setInputText(formatDateForDisplay(date));
      setParsedDate(date);
    }
  }, [value, inputText]);

  const formatDateForDisplay = (date: Date): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) {
      return "Today";
    } else if (dateOnly.getTime() === tomorrow.getTime()) {
      return "Tomorrow";
    } else {
      // Format as "Friday, Feb 21"
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  };

  const handleInputChange = (text: string) => {
    setInputText(text);

    if (!text.trim()) {
      setParsedDate(null);
      onChange("");
      return;
    }

    // Try to parse the natural language input
    const parsed = parseNaturalDate(text);

    if (parsed) {
      setParsedDate(parsed);
      
      // Convert to YYYY-MM-DD format
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      onChange(`${yyyy}-${mm}-${dd}`);
    } else {
      // No parse - clear the parsed date but keep the input
      setParsedDate(null);
      onChange("");
    }
  };

  const handleDatePickerChange = (dateString: string) => {
    if (!dateString) {
      setInputText("");
      setParsedDate(null);
      onChange("");
      return;
    }

    const date = new Date(dateString);
    setInputText(formatDateForDisplay(date));
    setParsedDate(date);
    onChange(dateString);
    setShowDatePicker(false);
  };

  const handleClear = () => {
    setInputText("");
    setParsedDate(null);
    onChange("");
  };

  return (
    <div className="space-y-2">
      {/* Natural language input */}
      <div className="relative">
        <input
          type="text"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-20 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
          {inputText && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label="Clear date"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDatePicker(!showDatePicker)}
            disabled={disabled}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Toggle date picker"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Parsed date preview */}
      {parsedDate && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-600 dark:text-green-400">✓</span>
          <span className="text-gray-600 dark:text-gray-400">
            {parsedDate.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
      )}

      {/* Date picker fallback (shown when calendar icon is clicked) */}
      {showDatePicker && (
        <div className="pt-1">
          <input
            type="date"
            value={value}
            onChange={(e) => handleDatePickerChange(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
