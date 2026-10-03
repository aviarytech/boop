/**
 * Hook for trapping focus within a modal dialog.
 *
 * Features:
 * - Traps Tab/Shift+Tab within the modal
 * - Handles ESC key to close modal
 * - Returns focus to trigger element on close
 * - Sets initial focus to first focusable element (or autoFocus element)
 */

import { useEffect, useRef, useCallback, type RefObject } from "react";

interface UseFocusTrapOptions {
  /** Called when ESC key is pressed */
  onEscape: () => void;
  /** Whether the focus trap is active (modal is open) */
  isActive?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap<T extends HTMLElement>(
  options: UseFocusTrapOptions
): RefObject<T | null> {
  const { onEscape, isActive = true } = options;
  const containerRef = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Get all focusable elements within the container
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
  }, []);

  // Handle Tab key to trap focus
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isActive) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Shift+Tab on first element -> go to last
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab on last element -> go to first
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
    },
    [isActive, onEscape, getFocusableElements]
  );

  // Store previously focused element and set initial focus
  useEffect(() => {
    if (!isActive) return;

    // Store the currently focused element to restore later
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    // Set initial focus after a small delay to ensure the modal is rendered
    const timeoutId = setTimeout(() => {
      if (!containerRef.current) return;

      // First, check if there's an element with autoFocus
      const autoFocusElement =
        containerRef.current.querySelector<HTMLElement>("[autofocus]");
      if (autoFocusElement) {
        autoFocusElement.focus();
        return;
      }

      // Otherwise, focus the first focusable element
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isActive, getFocusableElements]);

  // Return focus to trigger element on close
  useEffect(() => {
    return () => {
      // This runs when component unmounts (modal closes)
      if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, []);

  // Add keyboard event listener
  useEffect(() => {
    if (!isActive) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleKeyDown]);

  return containerRef;
}
