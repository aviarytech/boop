/**
 * Calendar view for items with due dates.
 */

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";

interface CalendarViewProps {
  listId: Id<"lists">;
  userDid: string;
  onItemClick?: (item: Doc<"items">) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function CalendarView({ listId, onItemClick }: CalendarViewProps) {
  const { haptic } = useSettings();
  const [currentDate, setCurrentDate] = useState(new Date());

  const allItems = useQuery(api.items.getListItems, { listId });

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);

  const items = useMemo(() => {
    if (!allItems) return [];
    return allItems.filter(item =>
      item.dueDate &&
      item.dueDate >= monthStart.getTime() &&
      item.dueDate <= monthEnd.getTime()
    );
  }, [allItems, monthStart.getTime(), monthEnd.getTime()]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, Doc<"items">[]>();
    for (const item of items) {
      if (!item.dueDate) continue;
      const dateKey = new Date(item.dueDate).toDateString();
      const existing = map.get(dateKey) ?? [];
      map.set(dateKey, [...existing, item]);
    }
    return map;
  }, [items]);

  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = [];
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null);
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), d));
    }
    return days;
  }, [currentDate]);

  const goToPreviousMonth = () => {
    haptic("light");
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    haptic("light");
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    haptic("light");
    setCurrentDate(new Date());
  };

  const isToday = (date: Date) => new Date().toDateString() === date.toDateString();

  if (!allItems) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={goToPreviousMonth}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h3>
          <button
            onClick={goToToday}
            className="text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            Today
          </button>
        </div>

        <button
          onClick={goToNextMonth}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {calendarDays.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="h-24 border-b border-r border-gray-100 dark:border-gray-700" />;
          }

          const dateItems = itemsByDate.get(date.toDateString()) ?? [];
          const today = isToday(date);

          return (
            <div
              key={date.toISOString()}
              className={`min-h-24 p-1 border-b border-r border-gray-100 dark:border-gray-700 ${today ? "bg-amber-50 dark:bg-amber-900/10" : ""}`}
            >
              <div className={`text-xs font-medium mb-1 ${today ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                {date.getDate()}
              </div>
              <div className="space-y-1">
                {dateItems.slice(0, 3).map((item) => (
                  <button
                    key={item._id}
                    onClick={() => { haptic("light"); onItemClick?.(item); }}
                    className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate transition-colors ${
                      item.checked
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 line-through"
                        : item.priority === "high"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                        : item.priority === "medium"
                        ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                        : "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
                {dateItems.length > 3 && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-1">
                    +{dateItems.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
