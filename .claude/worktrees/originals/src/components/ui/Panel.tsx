/**
 * Reusable Panel/Drawer component that slides up from the bottom.
 * Features:
 * - Slide-up animation from bottom
 * - Swipe-to-dismiss gesture support
 * - Backdrop click to close
 * - Full-height or auto-height modes
 * - Mobile-first design that feels native/app-like
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** If true, panel takes full height minus safe area */
  fullHeight?: boolean;
  /** Show drag handle at top for swipe gesture hint */
  showHandle?: boolean;
  /** Custom header content (replaces default title) */
  header?: ReactNode;
  /** Footer content (sticky at bottom) */
  footer?: ReactNode;
  /** aria-labelledby for accessibility */
  ariaLabelledBy?: string;
}

export function Panel({
  isOpen,
  onClose,
  children,
  title,
  fullHeight = false,
  showHandle = true,
  header,
  footer,
  ariaLabelledBy,
}: PanelProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startY: number;
    startTime: number;
    currentY: number;
    isDragging: boolean;
  } | null>(null);

  // Handle open/close animation
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      setIsClosing(false);
      // Lock body scroll
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsAnimating(false);
      setIsClosing(false);
      onClose();
    }, 200); // Match animation duration
  }, [onClose]);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, handleClose]);

  // Touch handlers for swipe-to-dismiss
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragState.current = {
      startY: touch.clientY,
      startTime: Date.now(),
      currentY: touch.clientY,
      isDragging: false,
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.current || !panelRef.current) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - dragState.current.startY;

    // Only allow dragging down (positive deltaY)
    if (deltaY > 10) {
      dragState.current.isDragging = true;
      dragState.current.currentY = touch.clientY;

      // Check if content is scrolled to top before allowing drag
      const content = contentRef.current;
      if (content && content.scrollTop > 0) {
        dragState.current.isDragging = false;
        return;
      }

      // Apply transform for visual feedback
      const clampedDelta = Math.min(deltaY, 300);
      panelRef.current.style.transform = `translateY(${clampedDelta}px)`;
      panelRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!dragState.current || !panelRef.current) return;

    const { startY, startTime, currentY, isDragging } = dragState.current;

    if (isDragging) {
      const deltaY = currentY - startY;
      const duration = Date.now() - startTime;
      const velocity = deltaY / duration;

      // Close if dragged far enough or with enough velocity
      if (deltaY > 100 || velocity > 0.5) {
        handleClose();
      } else {
        // Snap back
        panelRef.current.style.transform = "";
        panelRef.current.style.transition = "transform 0.2s ease-out";
      }
    }

    dragState.current = null;
  }, [handleClose]);

  if (!isOpen && !isAnimating) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex flex-col justify-end transition-colors duration-200 ${
        isClosing ? "bg-black/0" : "bg-black/50"
      }`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
    >
      <div
        ref={panelRef}
        className={`
          bg-white dark:bg-gray-800 
          rounded-t-2xl shadow-2xl 
          w-full 
          ${fullHeight ? "h-[90vh]" : "max-h-[90vh]"}
          flex flex-col
          safe-area-inset-bottom
          ${isClosing ? "animate-panel-close" : "animate-panel-open"}
        `}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag Handle */}
        {showHandle && (
          <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
          </div>
        )}

        {/* Header */}
        {(header || title) && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
            {header || (
              <>
                <h2
                  id={ariaLabelledBy}
                  className="text-lg font-semibold text-gray-900 dark:text-gray-100"
                >
                  {title}
                </h2>
                <button
                  onClick={handleClose}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
                  aria-label="Close panel"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
