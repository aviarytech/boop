/**
 * Custom hook for touch-based drag and drop on mobile.
 * Provides touch event handlers for reordering list items.
 */

import { useState, useRef, useCallback, useEffect, type RefObject } from "react";

export interface TouchDragState {
  isDragging: boolean;
  draggedId: string | null;
  dragOverId: string | null;
  touchY: number;
  startY: number;
  offsetY: number;
}

export interface UseTouchDragOptions {
  onReorder: (draggedId: string, targetId: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useTouchDrag({ onReorder, containerRef }: UseTouchDragOptions) {
  const [state, setState] = useState<TouchDragState>({
    isDragging: false,
    draggedId: null,
    dragOverId: null,
    touchY: 0,
    startY: 0,
    offsetY: 0,
  });

  const draggedElementRef = useRef<HTMLElement | null>(null);
  const initialRectRef = useRef<DOMRect | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const currentTouchYRef = useRef<number>(0);

  // Auto-scroll logic: scroll the window when dragging near viewport edges
  const EDGE_ZONE = 80; // px from top/bottom edge to trigger scroll
  const MAX_SCROLL_SPEED = 15; // px per frame at the very edge

  const startAutoScroll = useCallback(() => {
    const tick = () => {
      const y = currentTouchYRef.current;
      const vh = window.innerHeight;
      let speed = 0;

      if (y < EDGE_ZONE) {
        // Near top — scroll up. Closer to edge = faster.
        speed = -MAX_SCROLL_SPEED * (1 - y / EDGE_ZONE);
      } else if (y > vh - EDGE_ZONE) {
        // Near bottom — scroll down.
        speed = MAX_SCROLL_SPEED * (1 - (vh - y) / EDGE_ZONE);
      }

      if (speed !== 0) {
        window.scrollBy(0, speed);
      }

      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAutoScroll();
  }, [stopAutoScroll]);

  const handleTouchStart = useCallback((e: React.TouchEvent, itemId: string, element: HTMLElement) => {
    const touch = e.touches[0];
    const rect = element.getBoundingClientRect();
    
    draggedElementRef.current = element;
    initialRectRef.current = rect;
    
    setState({
      isDragging: true,
      draggedId: itemId,
      dragOverId: null,
      touchY: touch.clientY,
      startY: touch.clientY,
      offsetY: touch.clientY - rect.top,
    });
    
    currentTouchYRef.current = touch.clientY;
    startAutoScroll();

    // Add visual feedback
    element.style.zIndex = '1000';
    element.style.transition = 'none';
    element.style.opacity = '0.9';
    element.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
  }, [startAutoScroll]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!state.isDragging || !state.draggedId || !containerRef.current) return;

    // Only prevent default scrolling when actively dragging
    e.preventDefault();

    const touch = e.touches[0];
    currentTouchYRef.current = touch.clientY;
    const container = containerRef.current;
    const items = Array.from(container.querySelectorAll('[data-item-id]'));
    
    // Find which item we're hovering over
    let dragOverId: string | null = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        const itemId = item.getAttribute('data-item-id');
        if (itemId && itemId !== state.draggedId) {
          dragOverId = itemId;
        }
        break;
      }
    }

    setState(prev => ({
      ...prev,
      touchY: touch.clientY,
      dragOverId,
    }));

    // Move the dragged element
    if (draggedElementRef.current && initialRectRef.current) {
      const deltaY = touch.clientY - state.startY;
      draggedElementRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  }, [state.isDragging, state.draggedId, state.startY, containerRef]);

  const handleTouchEnd = useCallback(() => {
    stopAutoScroll();

    if (state.draggedId && state.dragOverId) {
      onReorder(state.draggedId, state.dragOverId);
    }

    // Reset visual styles
    if (draggedElementRef.current) {
      draggedElementRef.current.style.zIndex = '';
      draggedElementRef.current.style.transition = '';
      draggedElementRef.current.style.opacity = '';
      draggedElementRef.current.style.boxShadow = '';
      draggedElementRef.current.style.transform = '';
    }

    setState({
      isDragging: false,
      draggedId: null,
      dragOverId: null,
      touchY: 0,
      startY: 0,
      offsetY: 0,
    });

    draggedElementRef.current = null;
    initialRectRef.current = null;
  }, [state.draggedId, state.dragOverId, onReorder, stopAutoScroll]);

  return {
    state,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
