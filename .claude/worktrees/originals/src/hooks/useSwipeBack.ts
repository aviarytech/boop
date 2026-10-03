/**
 * useSwipeBack - Detect swipe-right from left edge to navigate back.
 * Mimics iOS back gesture for PWA/web views with visual slide animation.
 */
import { useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

const EDGE_THRESHOLD = 30; // px from left edge to start
const SWIPE_MIN_DISTANCE = 100; // px to trigger back
const SWIPE_MAX_Y = 50; // max vertical movement

export function useSwipeBack() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const trackingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const getOverlay = useCallback(() => {
    if (!overlayRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 99999;
        background: linear-gradient(to right, rgba(0,0,0,0.08) 0%, transparent 40%);
        opacity: 0; transition: none;
      `;
      document.body.appendChild(el);
      overlayRef.current = el;
    }
    return overlayRef.current;
  }, []);

  useEffect(() => {
    // Only enable swipe-back on native platforms; on web the browser
    // already provides its own back-swipe gesture, causing "double back".
    if (!Capacitor.isNativePlatform()) return;

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (touch.clientX <= EDGE_THRESHOLD) {
        startXRef.current = touch.clientX;
        startYRef.current = touch.clientY;
        trackingRef.current = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!trackingRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startXRef.current;
      const dy = Math.abs(touch.clientY - startYRef.current);

      if (dy > SWIPE_MAX_Y) {
        trackingRef.current = false;
        resetVisual();
        return;
      }

      if (dx > 0) {
        const progress = Math.min(dx / SWIPE_MIN_DISTANCE, 1);
        const overlay = getOverlay();
        overlay.style.opacity = String(progress);

        // Slide the page content slightly
        const translateX = Math.min(dx * 0.3, 60);
        document.body.style.transform = `translateX(${translateX}px)`;
        document.body.style.transition = "none";
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startXRef.current;
      const dy = Math.abs(touch.clientY - startYRef.current);

      if (dx >= SWIPE_MIN_DISTANCE && dy <= SWIPE_MAX_Y) {
        // Animate out then navigate back
        document.body.style.transition = "transform 0.2s ease-out";
        document.body.style.transform = "translateX(100%)";
        const overlay = getOverlay();
        overlay.style.transition = "opacity 0.2s ease-out";
        overlay.style.opacity = "0";
        setTimeout(() => {
          resetVisual();
          history.back();
          // Reset after navigation
          requestAnimationFrame(() => {
            document.body.style.transform = "";
            document.body.style.transition = "";
          });
        }, 200);
      } else {
        // Snap back
        document.body.style.transition = "transform 0.2s ease-out";
        document.body.style.transform = "";
        const overlay = getOverlay();
        overlay.style.transition = "opacity 0.2s ease-out";
        overlay.style.opacity = "0";
        setTimeout(() => {
          document.body.style.transition = "";
        }, 200);
      }
    }

    function resetVisual() {
      const overlay = overlayRef.current;
      if (overlay) overlay.style.opacity = "0";
      document.body.style.transform = "";
      document.body.style.transition = "";
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      if (overlayRef.current) {
        overlayRef.current.remove();
        overlayRef.current = null;
      }
      document.body.style.transform = "";
      document.body.style.transition = "";
    };
  }, [getOverlay]);
}
